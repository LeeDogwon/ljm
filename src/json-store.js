const path = require("node:path");
const fs = require("node:fs/promises");

const fileTaskQueues = new Map();

function enqueueFileTask(filePath, task) {
  const previous = fileTaskQueues.get(filePath) || Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  fileTaskQueues.set(filePath, next);
  next
    .finally(() => {
      if (fileTaskQueues.get(filePath) === next) {
        fileTaskQueues.delete(filePath);
      }
    })
    .catch(() => {});
  return next;
}

async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  );

  try {
    await fs.writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await fs.rename(tmpPath, filePath);
  } catch (error) {
    await fs.unlink(tmpPath).catch(() => {});
    throw error;
  }
}

module.exports = {
  enqueueFileTask,
  writeJsonAtomic,
};
