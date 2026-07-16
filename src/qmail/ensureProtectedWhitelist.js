/**
 * ensureProtectedWhitelist.js — re-assert protected support addresses on launch.
 *
 * Software / subscription support addresses must stay fee-waived (DRD white
 * list) and discoverable as contacts. Per project owner decision they are
 * re-added to the white list on every app launch (users may have removed
 * them); contacts are created only when missing so existing rows are not
 * duplicated or overwritten.
 */

import {
  addContact,
  getContacts,
  setDrdListEntries,
} from "../api/qmailApiServices";
import { PROTECTED_ADDRESSES } from "./protectedAddresses";

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 5000;

/** True after a fully successful run this launch; blocks remount re-runs. */
let hasSucceededThisLaunch = false;
/** True while an attempt sequence is in flight; blocks concurrent calls. */
let inFlight = false;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const contactMatchesProtected = (contact, entry) =>
  Number(contact.userId) === Number(entry.serialNumber) &&
  Number(contact.denomination) === Number(entry.denomination);

/**
 * Ensure protected addresses are on the DRD white list and present in contacts.
 * Runs at most once successfully per app launch; never throws.
 */
export async function ensureProtectedWhitelist() {
  if (hasSucceededThisLaunch || inFlight) return;

  inFlight = true;
  let succeeded = false;

  try {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      try {
        // Step 1 — always re-add to DRD white list (idempotent restore).
        const whiteEntries = PROTECTED_ADDRESSES.map(
          ({ denomination, serialNumber }) => ({
            denomination,
            serialNumber,
            listType: "white",
          }),
        );
        const drdResult = await setDrdListEntries(whiteEntries);
        if (!drdResult?.success) {
          throw new Error(
            drdResult?.error || "setDrdListEntries returned failure",
          );
        }

        // Step 2 — create missing contacts only (do not overwrite existing).
        const contactsResult = await getContacts();
        if (!contactsResult?.success) {
          throw new Error(
            contactsResult?.error || "getContacts returned failure",
          );
        }

        const existing = contactsResult?.data?.contacts || [];
        for (const entry of PROTECTED_ADDRESSES) {
          const alreadyPresent = existing.some((contact) =>
            contactMatchesProtected(contact, entry),
          );
          if (alreadyPresent) continue;

          const addResult = await addContact({
            serial_number: String(entry.serialNumber),
            denomination: String(entry.denomination),
            first_name: entry.firstName,
            last_name: entry.lastName,
            description: entry.description,
          });
          if (!addResult?.success) {
            throw new Error(
              addResult?.error ||
                `addContact failed for ${entry.address}`,
            );
          }
        }

        succeeded = true;
        hasSucceededThisLaunch = true;
        break;
      } catch (error) {
        console.warn(
          `ensureProtectedWhitelist: attempt ${attempt + 1}/${MAX_ATTEMPTS} failed:`,
          error,
        );
        if (attempt < MAX_ATTEMPTS - 1) {
          await delay(RETRY_DELAY_MS);
        }
      }
    }

    if (!succeeded) {
      // Leave hasSucceededThisLaunch false so a later dashboard remount can retry.
      console.warn(
        "ensureProtectedWhitelist: gave up after retries; will try again on next mount/launch.",
      );
    }
  } catch (error) {
    // Outer safety net — this function must never throw to callers.
    console.warn("ensureProtectedWhitelist: unexpected failure:", error);
  } finally {
    inFlight = false;
    if (!succeeded) {
      hasSucceededThisLaunch = false;
    }
  }
}
