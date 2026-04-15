import React from 'react';

import SettingsDetailScreen from '../components/settings/SettingsDetailScreen';
import { APP_PATHS, navigateToPath } from '../navigation/router';

export default function PaymentMethodsScreen() {
  return (
    <SettingsDetailScreen
      title="Payment Methods"
      icon="card-outline"
      statusLabel="Checkout ready"
      headline="UPI QR and PayPal are the active payment rails"
      description="This replaces the old subscription redirect so payment-method information now lives on its own screen."
      items={[
        {
          label: 'UPI QR Code',
          value: 'Available during supported booking checkout flows.',
        },
        {
          label: 'PayPal',
          value: 'Available during supported booking checkout flows.',
        },
        {
          label: 'Razorpay SDK',
          value: 'Not enabled in this build yet.',
        },
        {
          label: 'Stripe SDK',
          value: 'Not enabled in this build yet.',
        },
      ]}
      actions={[
        {
          label: 'Open Bookings',
          onPress: () => navigateToPath(APP_PATHS.SCREEN_BOOKINGS),
        },
        {
          label: 'Subscription & Premium',
          onPress: () => navigateToPath(APP_PATHS.SCREEN_PAYMENTS),
          variant: 'secondary',
        },
      ]}
    />
  );
}
