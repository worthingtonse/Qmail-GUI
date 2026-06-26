/**
 * qmail_receive_object_reconstruct_test.c - Streaming stripe reconstruction
 */

#include "qmail/qmail_receive_object_transfer.h"
#include "qmail/qmail_striping.h"
#include "sha256_util.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define DATA_STRIPES 3
#define BLOCK_PER_STRIPE (1024u * 1024u)

#define CHECK(condition, message) do { \
    if (!(condition)) { \
        fprintf(stderr, "FAIL: %s (line %d)\n", message, __LINE__); \
        goto cleanup; \
    } \
} while (0)

static int append_stage_block(FILE *outputs[DATA_STRIPES + 1],
                              const uint8_t *data,
                              size_t size) {
    uint8_t *stripes[DATA_STRIPES] = {0};
    size_t stripe_sizes[DATA_STRIPES] = {0};
    uint8_t *parity = NULL;
    size_t parity_size = 0;
    result_t result = qmail_stripe_split(
        data, size, DATA_STRIPES, stripes, stripe_sizes);
    if (result == RESULT_SUCCESS) {
        result = qmail_stripe_parity(
            (const uint8_t **)stripes, stripe_sizes, DATA_STRIPES,
            &parity, &parity_size);
    }
    if (result == RESULT_SUCCESS) {
        for (int i = 0; i < DATA_STRIPES; ++i) {
            if (fwrite(stripes[i], 1, stripe_sizes[i], outputs[i])
                != stripe_sizes[i]) {
                result = RESULT_FILE_ERROR;
                break;
            }
        }
    }
    if (result == RESULT_SUCCESS &&
        fwrite(parity, 1, parity_size, outputs[DATA_STRIPES])
            != parity_size) {
        result = RESULT_FILE_ERROR;
    }
    for (int i = 0; i < DATA_STRIPES; ++i) free(stripes[i]);
    free(parity);
    return result == RESULT_SUCCESS ? 0 : 1;
}

static int files_equal(const char *path, const uint8_t *expected, size_t size) {
    FILE *file = fopen(path, "rb");
    uint8_t buffer[8192];
    size_t offset = 0;
    if (!file) return 0;
    while (offset < size) {
        size_t want = size - offset;
        if (want > sizeof(buffer)) want = sizeof(buffer);
        if (fread(buffer, 1, want, file) != want ||
            memcmp(buffer, expected + offset, want) != 0) {
            fclose(file);
            return 0;
        }
        offset += want;
    }
    int extra = fgetc(file);
    fclose(file);
    return extra == EOF;
}

int main(void) {
    const char *paths[QMAIL_MAX_SERVERS] = {0};
    const char *all_paths[DATA_STRIPES + 1] = {
        "qmail_reconstruct_s0.bin",
        "qmail_reconstruct_s1.bin",
        "qmail_reconstruct_s2.bin",
        "qmail_reconstruct_parity.bin"
    };
    const char *output_path = "qmail_reconstruct_output.bin";
    FILE *outputs[DATA_STRIPES + 1] = {0};
    uint8_t *source = NULL;
    size_t source_size =
        DATA_STRIPES * BLOCK_PER_STRIPE + 12345u;
    size_t block_size = DATA_STRIPES * BLOCK_PER_STRIPE;
    uint8_t expected_hash[SHA256_DIGEST_SIZE];
    int recovered = 0;
    int exit_code = 1;

    for (int i = 0; i < DATA_STRIPES + 1; ++i) {
        remove(all_paths[i]);
        outputs[i] = fopen(all_paths[i], "wb");
        CHECK(outputs[i] != NULL, "create staged stripe");
    }
    source = (uint8_t *)malloc(source_size);
    CHECK(source != NULL, "allocate source");
    for (size_t i = 0; i < source_size; ++i) {
        source[i] = (uint8_t)((i * 131u + i / 17u) & 0xffu);
    }
    CHECK(append_stage_block(outputs, source, block_size) == 0,
          "stage full reconstruction block");
    CHECK(append_stage_block(outputs, source + block_size,
                             source_size - block_size) == 0,
          "stage final reconstruction block");
    for (int i = 0; i < DATA_STRIPES + 1; ++i) {
        CHECK(fclose(outputs[i]) == 0, "close staged stripe");
        outputs[i] = NULL;
        paths[i] = all_paths[i];
    }
    CHECK(sha256_digest(source, source_size, expected_hash) == RESULT_SUCCESS,
          "hash source");

    remove(output_path);
    CHECK(qmail_receive_object_reconstruct(
              paths, DATA_STRIPES, DATA_STRIPES, source_size,
              expected_hash, output_path, &recovered, NULL, 0)
              == RESULT_SUCCESS,
          "reconstruct complete data set");
    CHECK(recovered == 0, "no recovery reported");
    CHECK(files_equal(output_path, source, source_size),
          "complete reconstruction matches");

    remove(output_path);
    paths[1] = NULL;
    CHECK(qmail_receive_object_reconstruct(
              paths, DATA_STRIPES, DATA_STRIPES, source_size,
              expected_hash, output_path, &recovered, NULL, 0)
              == RESULT_SUCCESS,
          "reconstruct one missing stripe");
    CHECK(recovered == 1, "one recovery reported");
    CHECK(files_equal(output_path, source, source_size),
          "parity reconstruction matches");

    expected_hash[0] ^= 0xffu;
    remove(output_path);
    CHECK(qmail_receive_object_reconstruct(
              paths, DATA_STRIPES, DATA_STRIPES, source_size,
              expected_hash, output_path, &recovered, NULL, 0)
              != RESULT_SUCCESS,
          "reject logical hash mismatch");

    exit_code = 0;

cleanup:
    for (int i = 0; i < DATA_STRIPES + 1; ++i) {
        if (outputs[i]) fclose(outputs[i]);
        remove(all_paths[i]);
    }
    remove(output_path);
    free(source);
    return exit_code;
}
