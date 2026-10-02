import { ImageResponse } from 'next/og';
import { getT } from '@/lib/i18n/server';
export const alt = 'Riverz Dealers';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export async function renderDealerShareCard() {
  const t = await getT();
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: 80,
        background: '#f5f3ec',
        color: '#181917',
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ fontSize: 30, marginBottom: 50 }}>RIVERZ DEALERS</div>
      <div style={{ fontSize: 78, maxWidth: 1000, lineHeight: 1.08 }}>
        {t('dealers.hero')}
      </div>
      <div style={{ fontSize: 26, marginTop: 50, color: '#687063' }}>
        {t('dealers.subtitle')}
      </div>
    </div>,
    size
  );
}
