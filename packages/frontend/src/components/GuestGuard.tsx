import { useNavigate } from '@solidjs/router';
import { Show, createEffect, createSignal, onMount, type ParentComponent } from 'solid-js';
import { authClient } from '../services/auth-client.js';
import { checkNeedsSetup } from '../services/setup-status.js';

const GuestGuard: ParentComponent = (props) => {
  const session = authClient.useSession();
  const navigate = useNavigate();
  const [setupChecked, setSetupChecked] = createSignal(false);

  onMount(async () => {
    const needsSetup = await checkNeedsSetup();
    if (needsSetup) {
      navigate('/setup', { replace: true });
      return;
    }
    setSetupChecked(true);
  });

  createEffect(() => {
    const s = session();
    if (!s.isPending && s.data) {
      navigate('/', { replace: true });
    }
  });

  return (
    <Show when={setupChecked() && !session().isPending && !session().data} fallback={null}>
      {props.children}
    </Show>
  );
};

export default GuestGuard;
