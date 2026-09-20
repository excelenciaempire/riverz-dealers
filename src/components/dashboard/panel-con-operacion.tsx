'use client';
import { PanelDashboard } from '@/components/dashboard/panel-dashboard';
import { AprobarYEncender } from '@/components/operacion/aprobar-y-encender';
export function PanelConOperacion() {
  return (
    <>
      <div className="px-4 pt-4 lg:px-8 lg:pt-8">
        <AprobarYEncender />
      </div>
      <PanelDashboard />
    </>
  );
}
