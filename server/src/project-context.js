import { AsyncLocalStorage } from 'node:async_hooks';

export const legacyProjectKey = 'imperial-smuggler';
const context = new AsyncLocalStorage();
export const activeProject = () => context.getStore();
export const projectKey = () => activeProject()?.key ?? legacyProjectKey;
export const projectEra = () => activeProject()?.era ?? 'Imperial era';
export const settingsKey = (key = projectKey()) =>
  key === legacyProjectKey ? 'series' : `series:${key}`;
export const runProjectContext = (value, callback) => context.run(value, callback);
export const withoutProject = (callback) => context.run(undefined, callback);
export const belongsToProject = (record, key = projectKey()) =>
  (record.projectKey ?? legacyProjectKey) === key;
export const projectFilter = (key = projectKey()) =>
  key === legacyProjectKey
    ? { $or: [{ projectKey: key }, { projectKey: { $exists: false } }, { projectKey: null }] }
    : { projectKey: key };
// Requests and background jobs carry an explicit workspace. Maintenance/test scripts
// without a context can inventory all records; legacy documents need no rewrite.
export function projectScope(schema) {
  schema.add({ projectKey: { type: String, default: projectKey, index: true } });
  schema.pre(
    [
      'find',
      'findOne',
      'findOneAndUpdate',
      'findOneAndDelete',
      'updateOne',
      'updateMany',
      'deleteOne',
      'deleteMany',
      'countDocuments',
      'distinct'
    ],
    function () {
      if (!activeProject()) return;
      this.setQuery({ $and: [this.getFilter(), projectFilter()] });
    }
  );
}
