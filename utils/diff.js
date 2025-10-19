export function diffChanges(prev = {}, next = {}, basePath = "") {
  const changes = [];

  const prevObj = prev || {};
  const nextObj = next || {};

  const keys = new Set([
    ...Object.keys(prevObj),
    ...Object.keys(nextObj),
  ]);

  for (const key of keys) {
    if (["history", "_id", "__v"].includes(key)) continue;

    const path = basePath ? `${basePath}.${key}` : key;
    const prevVal = prevObj[key];
    const nextVal = nextObj[key];

    const bothObjects =
      prevVal &&
      nextVal &&
      typeof prevVal === "object" &&
      typeof nextVal === "object" &&
      !Array.isArray(prevVal) &&
      !Array.isArray(nextVal) &&
      !(prevVal instanceof Date) &&
      !(nextVal instanceof Date);

    if (bothObjects) {
      changes.push(...diffChanges(prevVal, nextVal, path));
    } else {
      const formattedPrev =
        prevVal instanceof Date ? prevVal.toISOString() : JSON.stringify(prevVal);
      const formattedNext =
        nextVal instanceof Date ? nextVal.toISOString() : JSON.stringify(nextVal);

      if (formattedPrev !== formattedNext) {
        changes.push({
          field: path,
          oldValue: prevVal ?? null,
          newValue: nextVal ?? null,
        });
      }
    }
  }

  return changes;
}
