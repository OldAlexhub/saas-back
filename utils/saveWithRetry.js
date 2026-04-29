// Retries a Mongoose save/create when a random ID collides with an existing one.
// The unique index catches the collision; we retry to get a new random ID from the pre-save hook.
export async function saveWithIdRetry(createFn, idFields = ['driverId', 'bookingId'], maxRetries = 3) {
  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await createFn();
    } catch (err) {
      const isIdCollision =
        err.code === 11000 &&
        err.keyPattern &&
        idFields.some((f) => err.keyPattern[f]);
      if (isIdCollision) {
        lastError = err;
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}
