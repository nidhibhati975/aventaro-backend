import React from 'react';

import SettingsDetailScreen from '../components/settings/SettingsDetailScreen';
import { APP_PATHS, navigateToPath } from '../navigation/router';

export default function LocationSharingScreen() {
  return (
    <SettingsDetailScreen
      title="Location Sharing"
      icon="location-outline"
      statusLabel="Off"
      headline="Live location sharing is opt-in and safety-first"
      description="This now routes to a dedicated location-sharing screen instead of opening the traveler discovery map."
      items={[
        {
          label: 'Trip members',
          value: 'Real-time trip-member sharing is not enabled yet in this build.',
        },
        {
          label: 'Emergency contacts',
          value: 'Emergency contact management is handled from the SOS safety screen.',
        },
        {
          label: 'Background location',
          value: 'Disabled until sharing setup and permissions are fully configured.',
        },
      ]}
      actions={[
        {
          label: 'Emergency Contacts',
          onPress: () => navigateToPath(APP_PATHS.SCREEN_EMERGENCY_SOS),
        },
        {
          label: 'Traveler Map',
          onPress: () => navigateToPath(APP_PATHS.SCREEN_TRAVELER_MAP),
          variant: 'secondary',
        },
      ]}
    />
  );
}
