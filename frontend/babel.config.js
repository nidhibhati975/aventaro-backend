const path = require('path');

const rootEnvPath = path.resolve(__dirname, '../.env');

module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    [
      'module:react-native-dotenv',
      {
        moduleName: '@env',
        path: rootEnvPath,
        allowlist: ['APP_ENV', 'API_BASE_URL', 'BACKEND_URL', 'FRONTEND_SENTRY_DSN'],
        allowUndefined: true,
      },
    ],
  ],
};
