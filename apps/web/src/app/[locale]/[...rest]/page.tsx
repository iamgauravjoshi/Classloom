import { notFound } from 'next/navigation';

/** Sends unknown multi-segment paths to the localized not-found page. */
export default function CatchAll() {
  notFound();
}
