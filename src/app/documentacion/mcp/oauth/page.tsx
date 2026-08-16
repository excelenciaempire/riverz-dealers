import { permanentRedirect } from 'next/navigation';

export default function RedirOauth(): never {
  permanentRedirect('/documentacion#oauth');
}
