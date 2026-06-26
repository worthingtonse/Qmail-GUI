/**
 * sha256_util.c - SHA-256 Hash Utility
 *
 * Platform-specific SHA-256:
 *   Windows: BCrypt API
 *   Linux/macOS: OpenSSL EVP
 */

#include "sha256_util.h"
#include "logging.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32

#include <windows.h>
#include <bcrypt.h>

result_t sha256_digest(const uint8_t *data,
                       size_t data_len,
                       uint8_t digest_out[SHA256_DIGEST_SIZE]) {
    BCRYPT_ALG_HANDLE hAlg = NULL;
    BCRYPT_HASH_HANDLE hHash = NULL;
    NTSTATUS status;
    result_t ret = RESULT_ERROR;
    const uint8_t *cursor = data;
    size_t remaining = data_len;

    if ((!data && data_len > 0) || !digest_out) {
        return RESULT_INVALID_PARAM;
    }

    status = BCryptOpenAlgorithmProvider(&hAlg, BCRYPT_SHA256_ALGORITHM, NULL, 0);
    if (!BCRYPT_SUCCESS(status)) {
        log_error(LOG_CAT_CRYPTO, "SHA256: BCryptOpenAlgorithmProvider failed: 0x%08X",
                  (unsigned)status);
        return RESULT_ERROR;
    }

    status = BCryptCreateHash(hAlg, &hHash, NULL, 0, NULL, 0, 0);
    if (!BCRYPT_SUCCESS(status)) {
        log_error(LOG_CAT_CRYPTO, "SHA256: BCryptCreateHash failed: 0x%08X",
                  (unsigned)status);
        BCryptCloseAlgorithmProvider(hAlg, 0);
        return RESULT_ERROR;
    }

    while (remaining > 0) {
        ULONG chunk_size =
            remaining > UINT32_MAX ? UINT32_MAX : (ULONG)remaining;
        status = BCryptHashData(hHash, (PUCHAR)cursor, chunk_size, 0);
        if (!BCRYPT_SUCCESS(status)) {
            log_error(LOG_CAT_CRYPTO,
                      "SHA256: BCryptHashData failed: 0x%08X",
                      (unsigned)status);
            goto cleanup;
        }
        cursor += chunk_size;
        remaining -= chunk_size;
    }

    status = BCryptFinishHash(
        hHash, digest_out, SHA256_DIGEST_SIZE, 0);
    if (!BCRYPT_SUCCESS(status)) {
        log_error(LOG_CAT_CRYPTO, "SHA256: BCryptFinishHash failed: 0x%08X",
                  (unsigned)status);
        goto cleanup;
    }

    ret = RESULT_SUCCESS;

cleanup:
    BCryptDestroyHash(hHash);
    BCryptCloseAlgorithmProvider(hAlg, 0);
    return ret;
}

#else /* Linux / macOS */

#include <openssl/evp.h>

result_t sha256_digest(const uint8_t *data,
                       size_t data_len,
                       uint8_t digest_out[SHA256_DIGEST_SIZE]) {
    EVP_MD_CTX *ctx = EVP_MD_CTX_new();
    unsigned int digest_len = 0;
    int ok;

    if ((!data && data_len > 0) || !digest_out) {
        return RESULT_INVALID_PARAM;
    }
    if (!ctx) {
        log_error(LOG_CAT_CRYPTO, "SHA256: EVP_MD_CTX_new failed");
        return RESULT_ERROR;
    }

    ok = EVP_DigestInit_ex(ctx, EVP_sha256(), NULL) == 1;
    if (ok && data_len > 0) {
        ok = EVP_DigestUpdate(ctx, data, data_len) == 1;
    }
    if (ok) {
        ok = EVP_DigestFinal_ex(ctx, digest_out, &digest_len) == 1;
    }
    if (!ok || digest_len != SHA256_DIGEST_SIZE) {
        log_error(LOG_CAT_CRYPTO, "SHA256: EVP digest operation failed");
        EVP_MD_CTX_free(ctx);
        return RESULT_ERROR;
    }

    EVP_MD_CTX_free(ctx);
    return RESULT_SUCCESS;
}

#endif

result_t sha256_hex(const uint8_t *data, size_t data_len, char *hex_out) {
    static const char HEX[] = "0123456789abcdef";
    uint8_t digest[SHA256_DIGEST_SIZE];
    size_t i;
    result_t result;

    if (!hex_out) return RESULT_INVALID_PARAM;
    result = sha256_digest(data, data_len, digest);
    if (result != RESULT_SUCCESS) return result;

    for (i = 0; i < SHA256_DIGEST_SIZE; ++i) {
        hex_out[i * 2] = HEX[digest[i] >> 4];
        hex_out[i * 2 + 1] = HEX[digest[i] & 0x0f];
    }
    hex_out[SHA256_HEX_LENGTH] = '\0';
    return RESULT_SUCCESS;
}

result_t sha256_file(const char *path,
                     uint8_t digest_out[SHA256_DIGEST_SIZE],
                     uint64_t *size_out) {
    uint8_t *buffer = NULL;
    FILE *file = NULL;
    uint64_t total = 0;
    result_t result = RESULT_ERROR;
    const size_t buffer_size = 1024u * 1024u;

    if (!path || !digest_out) return RESULT_INVALID_PARAM;
    if (size_out) *size_out = 0;

    file = fopen(path, "rb");
    if (!file) return RESULT_FILE_ERROR;
    buffer = (uint8_t *)malloc(buffer_size);
    if (!buffer) {
        fclose(file);
        return RESULT_MEMORY_ERROR;
    }

#ifdef _WIN32
    BCRYPT_ALG_HANDLE algorithm = NULL;
    BCRYPT_HASH_HANDLE hash = NULL;
    NTSTATUS status = BCryptOpenAlgorithmProvider(
        &algorithm, BCRYPT_SHA256_ALGORITHM, NULL, 0);
    if (!BCRYPT_SUCCESS(status)) goto cleanup;
    status = BCryptCreateHash(algorithm, &hash, NULL, 0, NULL, 0, 0);
    if (!BCRYPT_SUCCESS(status)) {
        BCryptCloseAlgorithmProvider(algorithm, 0);
        goto cleanup;
    }
    for (;;) {
        size_t count = fread(buffer, 1, buffer_size, file);
        if (count > 0) {
            status = BCryptHashData(hash, buffer, (ULONG)count, 0);
            if (!BCRYPT_SUCCESS(status)) break;
            total += count;
        }
        if (count < buffer_size) {
            if (ferror(file)) status = (NTSTATUS)-1;
            break;
        }
    }
    if (BCRYPT_SUCCESS(status)) {
        status = BCryptFinishHash(hash, digest_out, SHA256_DIGEST_SIZE, 0);
    }
    if (BCRYPT_SUCCESS(status)) result = RESULT_SUCCESS;
    BCryptDestroyHash(hash);
    BCryptCloseAlgorithmProvider(algorithm, 0);
#else
    EVP_MD_CTX *ctx = EVP_MD_CTX_new();
    unsigned int digest_len = 0;
    int ok = ctx && EVP_DigestInit_ex(ctx, EVP_sha256(), NULL) == 1;
    while (ok) {
        size_t count = fread(buffer, 1, buffer_size, file);
        if (count > 0) {
            ok = EVP_DigestUpdate(ctx, buffer, count) == 1;
            total += count;
        }
        if (count < buffer_size) {
            if (ferror(file)) ok = 0;
            break;
        }
    }
    if (ok) ok = EVP_DigestFinal_ex(ctx, digest_out, &digest_len) == 1;
    if (ok && digest_len == SHA256_DIGEST_SIZE) result = RESULT_SUCCESS;
    EVP_MD_CTX_free(ctx);
#endif

cleanup:
    free(buffer);
    fclose(file);
    if (result == RESULT_SUCCESS && size_out) *size_out = total;
    return result;
}
