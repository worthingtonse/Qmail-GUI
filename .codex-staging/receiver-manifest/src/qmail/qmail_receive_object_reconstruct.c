/**
 * qmail_receive_object_reconstruct.c - Streaming logical object rebuild
 */

#include "qmail/qmail_receive_object_transfer.h"
#include "qmail/qmail_striping.h"
#include "qmail/qmail_transfer_manager.h"
#include "filesystem.h"
#include "platform.h"
#include "sha256_util.h"
#include "utils.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32
#include <direct.h>
#define qmail_mkdir(path) _mkdir(path)
#else
#include <sys/stat.h>
#define qmail_mkdir(path) mkdir(path, 0700)
#endif

#define RECEIVE_STRIPE_BLOCK_BYTES (1024u * 1024u)

static void set_error(char *out, size_t out_size, const char *message) {
    if (out && out_size > 0) {
        snprintf(out, out_size, "%s", message ? message : "");
    }
}

static result_t ensure_directory(const char *path) {
    char copy[QMAIL_TRANSFER_PATH_MAX];
    char *cursor;
    if (!path || !path[0] || strlen(path) >= sizeof(copy)) {
        return RESULT_INVALID_PARAM;
    }
    snprintf(copy, sizeof(copy), "%s", path);
    cursor = copy;
#ifdef _WIN32
    if (copy[0] && copy[1] == ':') cursor = copy + 2;
#endif
    while (*cursor) {
        if ((*cursor == '/' || *cursor == '\\') && cursor > copy) {
            char saved = *cursor;
            *cursor = '\0';
            qmail_mkdir(copy);
            *cursor = saved;
        }
        cursor++;
    }
    qmail_mkdir(copy);
    return RESULT_SUCCESS;
}

static result_t ensure_parent_directory(const char *path) {
    char parent[QMAIL_TRANSFER_PATH_MAX];
    char *slash;
    if (!path || !path[0] || strlen(path) >= sizeof(parent)) {
        return RESULT_INVALID_PARAM;
    }
    snprintf(parent, sizeof(parent), "%s", path);
    slash = strrchr(parent, '/');
    {
        char *backslash = strrchr(parent, '\\');
        if (!slash || (backslash && backslash > slash)) slash = backslash;
    }
    if (!slash) return RESULT_SUCCESS;
#ifdef _WIN32
    if (slash == parent + 2 && parent[1] == ':') return RESULT_SUCCESS;
#endif
    *slash = '\0';
    return parent[0] ? ensure_directory(parent) : RESULT_SUCCESS;
}

static size_t stripe_bytes_for_logical_chunk(size_t logical_size,
                                             int data_stripe_count) {
    if (logical_size == 0 || data_stripe_count <= 0 ||
        logical_size > SIZE_MAX / 8u) {
        return 0;
    }
    size_t total_bits = logical_size * 8u;
    size_t bits_per_stripe =
        (total_bits + (size_t)data_stripe_count - 1u) /
        (size_t)data_stripe_count;
    return (bits_per_stripe + 7u) / 8u;
}

static result_t read_exact(FILE *file, uint8_t *data, size_t size) {
    if (!file || (!data && size > 0)) return RESULT_INVALID_PARAM;
    return size == 0 || fread(data, 1, size, file) == size
        ? RESULT_SUCCESS : RESULT_FILE_ERROR;
}

result_t qmail_receive_object_reconstruct(
    const char *const stripe_paths[QMAIL_MAX_SERVERS],
    int data_stripe_count,
    int parity_stripe_index,
    uint64_t original_size,
    const uint8_t expected_hash[QMAIL_OT_HASH_SIZE],
    const char *destination_path,
    int *stripes_recovered_out,
    char *error_out,
    size_t error_out_size) {
    FILE *inputs[QMAIL_MAX_SERVERS] = {0};
    FILE *output = NULL;
    uint8_t *buffers[QMAIL_MAX_SERVERS] = {0};
    char temporary_path[QMAIL_TRANSFER_PATH_MAX] = {0};
    int missing_index = -1;
    int missing_count = 0;
    uint64_t remaining = original_size;
    result_t status = RESULT_SUCCESS;

    if (stripes_recovered_out) *stripes_recovered_out = 0;
    if (!stripe_paths || !expected_hash || !destination_path ||
        data_stripe_count <= 0 ||
        data_stripe_count >= QMAIL_MAX_SERVERS ||
        original_size == 0) {
        return RESULT_INVALID_PARAM;
    }
    if (parity_stripe_index >= QMAIL_MAX_SERVERS) {
        return RESULT_INVALID_PARAM;
    }

    for (int i = 0; i < data_stripe_count; ++i) {
        if (!stripe_paths[i] || !stripe_paths[i][0]) {
            missing_index = i;
            missing_count++;
            continue;
        }
        inputs[i] = fopen(stripe_paths[i], "rb");
        if (!inputs[i]) {
            missing_index = i;
            missing_count++;
        }
    }
    if (missing_count > 1 ||
        (missing_count == 1 &&
         (parity_stripe_index < 0 ||
          !stripe_paths[parity_stripe_index] ||
          !stripe_paths[parity_stripe_index][0]))) {
        set_error(error_out, error_out_size,
                  "The revised-manifest object does not have a recoverable stripe set");
        status = RESULT_NOT_FOUND;
        goto cleanup;
    }
    if (missing_count == 1) {
        inputs[parity_stripe_index] =
            fopen(stripe_paths[parity_stripe_index], "rb");
        if (!inputs[parity_stripe_index]) {
            set_error(error_out, error_out_size,
                      "The parity stripe could not be opened");
            status = RESULT_FILE_ERROR;
            goto cleanup;
        }
    }

    if (ensure_parent_directory(destination_path) != RESULT_SUCCESS) {
        set_error(error_out, error_out_size,
                  "The reconstructed object directory could not be created");
        status = RESULT_FILE_ERROR;
        goto cleanup;
    }
    uint8_t suffix[8];
    char suffix_hex[17];
    platform_random_bytes(suffix, sizeof(suffix));
    utils_bytes_to_hex(suffix, sizeof(suffix), suffix_hex);
    if (snprintf(temporary_path, sizeof(temporary_path), "%s.%s.qmail.rebuild",
                 destination_path, suffix_hex) >= (int)sizeof(temporary_path)) {
        status = RESULT_INVALID_PARAM;
        goto cleanup;
    }
    output = fopen(temporary_path, "wb");
    if (!output) {
        set_error(error_out, error_out_size,
                  "The reconstructed object file could not be created");
        status = RESULT_FILE_ERROR;
        goto cleanup;
    }

    while (remaining > 0) {
        uint64_t logical_capacity =
            (uint64_t)data_stripe_count * RECEIVE_STRIPE_BLOCK_BYTES;
        size_t logical_size = remaining < logical_capacity
            ? (size_t)remaining : (size_t)logical_capacity;
        size_t stripe_size =
            stripe_bytes_for_logical_chunk(logical_size, data_stripe_count);
        const uint8_t *data_stripes[QMAIL_MAX_SERVERS] = {0};
        size_t data_sizes[QMAIL_MAX_SERVERS] = {0};
        uint8_t *recovered = NULL;
        size_t recovered_size = 0;
        uint8_t *logical_data = NULL;
        size_t logical_data_size = 0;

        if (stripe_size == 0) {
            status = RESULT_ERROR;
            goto cleanup;
        }
        for (int i = 0; i < data_stripe_count; ++i) {
            if (i == missing_index) continue;
            if (!buffers[i]) {
                buffers[i] = (uint8_t *)malloc(RECEIVE_STRIPE_BLOCK_BYTES);
                if (!buffers[i]) {
                    status = RESULT_MEMORY_ERROR;
                    goto chunk_cleanup;
                }
            }
            status = read_exact(inputs[i], buffers[i], stripe_size);
            if (status != RESULT_SUCCESS) {
                set_error(error_out, error_out_size,
                          "A downloaded data stripe is truncated");
                goto chunk_cleanup;
            }
            data_stripes[i] = buffers[i];
            data_sizes[i] = stripe_size;
        }

        if (missing_count == 1) {
            int parity = parity_stripe_index;
            if (!buffers[parity]) {
                buffers[parity] =
                    (uint8_t *)malloc(RECEIVE_STRIPE_BLOCK_BYTES);
                if (!buffers[parity]) {
                    status = RESULT_MEMORY_ERROR;
                    goto chunk_cleanup;
                }
            }
            status = read_exact(inputs[parity], buffers[parity], stripe_size);
            if (status != RESULT_SUCCESS) {
                set_error(error_out, error_out_size,
                          "The downloaded parity stripe is truncated");
                goto chunk_cleanup;
            }
            status = qmail_stripe_recover(
                data_stripes, data_sizes, data_stripe_count,
                buffers[parity], stripe_size, missing_index,
                &recovered, &recovered_size);
            if (status != RESULT_SUCCESS) goto chunk_cleanup;
            data_stripes[missing_index] = recovered;
            data_sizes[missing_index] = recovered_size;
        }

        status = qmail_stripe_reassemble(
            data_stripes, data_sizes, data_stripe_count,
            logical_size, &logical_data, &logical_data_size);
        if (status != RESULT_SUCCESS ||
            logical_data_size != logical_size ||
            fwrite(logical_data, 1, logical_data_size, output)
                != logical_data_size) {
            if (status == RESULT_SUCCESS) status = RESULT_FILE_ERROR;
            set_error(error_out, error_out_size,
                      "The revised-manifest object could not be reconstructed");
            goto chunk_cleanup;
        }
        remaining -= logical_data_size;

chunk_cleanup:
        free(recovered);
        free(logical_data);
        if (status != RESULT_SUCCESS) goto cleanup;
    }

    if (fclose(output) != 0) {
        output = NULL;
        status = RESULT_FILE_ERROR;
        goto cleanup;
    }
    output = NULL;

    {
        uint8_t actual_hash[QMAIL_OT_HASH_SIZE];
        uint64_t actual_size = 0;
        status = sha256_file(temporary_path, actual_hash, &actual_size);
        if (status != RESULT_SUCCESS ||
            actual_size != original_size ||
            memcmp(actual_hash, expected_hash, QMAIL_OT_HASH_SIZE) != 0) {
            set_error(error_out, error_out_size,
                      "The reconstructed object failed revised-manifest SHA-256 verification");
            status = RESULT_ERROR;
            goto cleanup;
        }
    }
    status = fs_atomic_rename(temporary_path, destination_path);
    if (status != RESULT_SUCCESS) {
        set_error(error_out, error_out_size,
                  "The verified object could not be moved to its destination");
        goto cleanup;
    }
    temporary_path[0] = '\0';
    if (stripes_recovered_out) *stripes_recovered_out = missing_count;

cleanup:
    if (output) fclose(output);
    if (status != RESULT_SUCCESS && temporary_path[0]) remove(temporary_path);
    for (int i = 0; i < QMAIL_MAX_SERVERS; ++i) {
        if (inputs[i]) fclose(inputs[i]);
        free(buffers[i]);
    }
    return status;
}
