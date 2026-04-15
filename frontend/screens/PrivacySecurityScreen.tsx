import React from 'react';

import SettingsDetailScreen from '../components/settings/SettingsDetailScreen';
import { APP_PATHS, navigateToPath } from '../navigation/router';

export default function PrivacySecurityScreen() {
  return (
    <SettingsDetailScreen
      title="Privacy & Security"
      icon="lock-closed-outline"
      statusLabel="Review"
      headline="Manage privacy, safety, and account controls"
      description="This screen replaces the old Help redirect so privacy controls live in the right place."
      items={[
        {
          label: 'Profile visibility',
          value: 'Your traveler profile stays inside Aventaro and is shown to relevant members in-app.',
        },
        {
          label: 'Trip activity access',
          value: 'Trip updates are intended for approved members and matched travelers, not public viewers.',
        },
        {
          label: 'Legal controls',
          value: 'Terms, privacy, and support escalation will continue to be finalized here instead of a generic help page.',
        },
      ]}
      actions={[
        {
          label: 'Open Help & Support',
          onPress: () => navigateToPath(APP_PATHS.SCREEN_HELP_SUPPORT),
          variant: 'secondary',
        },
      ]}
    />
  );
}
