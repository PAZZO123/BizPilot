import { useState } from 'react';
import { Download } from 'lucide-react';
import toast from 'react-hot-toast';
import { downloadFile, errorMessage, isPlanLimitError } from '../lib/api';
import { Spinner } from './ui';

/**
 * Downloads a report PDF.
 *
 * Not a `<a href>` — the endpoint needs a bearer token and an anchor sends no
 * Authorization header. The busy state matters more than it looks: a report over
 * a long period takes a second or two, and without it the shopkeeper presses the
 * button four times and gets four copies.
 */
export function DownloadPdfButton({
  label,
  path,
  params,
  className = 'btn-secondary',
}: {
  label: string;
  path: string;
  params?: Record<string, string | undefined>;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      await downloadFile(path, params);
    } catch (error) {
      // A plan refusal is not a failure, it is an upsell — give it room to be
      // read rather than the default flash.
      toast.error(errorMessage(error), { duration: isPlanLimitError(error) ? 7000 : 4000 });
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" className={className} onClick={() => void run()} disabled={busy}>
      {busy ? <Spinner className="h-4 w-4" /> : <Download className="h-4 w-4" />}
      {busy ? 'Preparing…' : label}
    </button>
  );
}
