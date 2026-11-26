// Reading settings from the environment. A typo must stop the service, not silently remove a limit.
function requiredEnv(env, name) {
  const value = env[name];
  if (!value || !value.trim()) throw new Error(`Missing environment variable ${name}`);
  return value.trim();
}

function positiveNumberEnv(env, name) {
  const value = Number(requiredEnv(env, name));
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
  return value;
}

module.exports = { requiredEnv, positiveNumberEnv };
