import React from 'react';

import SettingsDetailScreen from '../components/settings/SettingsDetailScreen';
import { APP_PATHS, navigateToPath } from '../navigation/router';

export default function TwoFactorAuthScreen() {
  return (
    <SettingsDetailScreen
      title="Two-Factor Authentication"
      icon="shield-checkmark-outline"
      statusLabel="Not enabled"
      headline="Add a second verification step for sensitive account actions"
      description="This now routes to a dedicated security screen instead of Help. Full backend-backed 2FA activation will be wired in the next phase."
      items={[
        {
          label: 'Authenticator app',
          value: 'Not enabled in the current app build.',
        },
        {
          label: 'Backup verification',
          value: 'Email or OTP fallback will be activated once the account-security backend is available.',
        },
        {
          label: 'Current protection',
          value: 'Your account still uses password authentication plus secure session storage.',
        },
      ]}
      actions={[
        {
          label: 'Privacy & Security',
          onPress: () => navigateToPath(APP_PATHS.SCREEN_PRIVACY_SECURITY),
          variant: 'secondary',
        },
      ]}
    />
  );
}
