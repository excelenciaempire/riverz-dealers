import type { Metadata } from 'next';
import { AppointmentPortal } from '@/components/dealers/appointment-portal';
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export default function Page() {
  return <AppointmentPortal />;
}
