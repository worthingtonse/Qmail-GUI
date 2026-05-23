export const SKIP_AUTO_RESTORE_KEY = "qmail.skipAutoRestore";

export const isLocalStorageAvailable = () => {
  try {
    if (typeof window === "undefined" || !window.localStorage) return false;
    const testKey = "qmail.storageTest";
    window.localStorage.setItem(testKey, "1");
    window.localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
};

export const shouldSkipAutoRestore = () => {
  try {
    return window.localStorage.getItem(SKIP_AUTO_RESTORE_KEY) === "1";
  } catch {
    return false;
  }
};

export const setSkipAutoRestore = () => {
  try {
    window.localStorage.setItem(SKIP_AUTO_RESTORE_KEY, "1");
    return true;
  } catch {
    return false;
  }
};

export const clearSkipAutoRestore = () => {
  try {
    window.localStorage.removeItem(SKIP_AUTO_RESTORE_KEY);
    return true;
  } catch {
    return false;
  }
};

export const clearQmailLocalStorageExceptSkip = () => {
  try {
    const keysToRemove = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (
        key &&
        key.startsWith("qmail.") &&
        key !== SKIP_AUTO_RESTORE_KEY
      ) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => window.localStorage.removeItem(key));
    return true;
  } catch {
    return false;
  }
};
