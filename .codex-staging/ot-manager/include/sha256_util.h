/**
 * sha256_util.h - SHA-256 Hash Utility
 *
 * Platform-specific SHA-256 implementation:
 *   Windows: BCrypt (BCRYPT_SHA256_ALGORITHM)
 *   Linux/macOS: OpenSSL (EVP_sha256)
 */

#ifndef SHA256_UTIL_H
#define SHA256_UTIL_H

#include "platform.h"
#include <stdint.h>
#include <stddef.h>

#define SHA256_DIGEST_SIZE 32
#define SHA256_HEX_LENGTH 64  /* 32 bytes * 2 hex chars each */
#define SHA256_HEX_BUFSIZE 65 /* 64 hex chars + null terminator */

/**
 * Compute SHA-256 hash of a memory buffer as the raw 32-byte digest.
 *
 * @param data        Input data, or NULL only when data_len is zero
 * @param data_len    Length of input data in bytes
 * @param digest_out  Output buffer (must be SHA256_DIGEST_SIZE bytes)
 * @return RESULT_SUCCESS or an error result
 */
result_t sha256_digest(const uint8_t *data,
                       size_t data_len,
                       uint8_t digest_out[SHA256_DIGEST_SIZE]);

/**
 * Compute SHA-256 hash of a memory buffer and return as hex string.
 *
 * @param data      Input data
 * @param data_len  Length of input data in bytes
 * @param hex_out   Output buffer for lowercase hex string (must be >= SHA256_HEX_BUFSIZE bytes)
 * @return RESULT_SUCCESS or RESULT_ERROR
 */
result_t sha256_hex(const uint8_t *data, size_t data_len, char *hex_out);

/**
 * Compute SHA-256 for a file without loading the complete file into memory.
 */
result_t sha256_file(const char *path,
                     uint8_t digest_out[SHA256_DIGEST_SIZE],
                     uint64_t *size_out);

#endif /* SHA256_UTIL_H */
