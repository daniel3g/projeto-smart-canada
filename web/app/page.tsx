import { DeviceDashboard } from "@/components/DeviceDashboard";
import { DEFAULT_DEVICE_KEY } from "@/lib/constants";

/**
 * Página pública de monitoramento. Sem login.
 *
 * O shell é estático de propósito: nenhum dado de requisição é lido aqui. Os
 * valores chegam pela API pública, do cliente, e o controle só aparece para
 * quem a API reconhece como admin.
 */
export default function Page() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
      <DeviceDashboard deviceKey={DEFAULT_DEVICE_KEY} />
    </main>
  );
}
