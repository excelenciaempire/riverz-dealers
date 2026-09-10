import { notFound } from 'next/navigation';
import { brands, type Brand } from '../data';
import { Onboarding } from '../presentation';

export default async function Page({
  params,
}: {
  params: Promise<{ brand: string }>;
}) {
  const { brand } = await params;
  if (!brands.includes(brand as Brand)) notFound();
  return <Onboarding key={brand} brand={brand as Brand} />;
}
