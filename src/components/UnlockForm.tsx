'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { setOwnerKey } from '@/lib/owner-store.ts';

export function UnlockForm() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'wrong'>('idle');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState('busy');
    const res = await fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
      cache: 'no-store',
    }).catch(() => null);
    const body = res?.ok ? await res.json() : null;
    if (!body?.key) {
      setState('wrong');
      setPassword('');
      return;
    }
    setOwnerKey(body.key);
    router.replace('/'); // client navigation: the key survives, a reload would not
  };

  return (
    <form className="unlock-form" onSubmit={submit}>
      <label htmlFor="pw" className="mono muted">
        Password
      </label>
      <input
        id="pw"
        type="password"
        autoFocus
        autoComplete="current-password"
        value={password}
        onChange={(e) => {
          setPassword(e.target.value);
          if (state === 'wrong') setState('idle');
        }}
        disabled={state === 'busy'}
      />
      <p className="unlock-msg mono" aria-live="polite">
        {state === 'wrong' ? 'Incorrect' : state === 'busy' ? '…' : ' '}
      </p>
    </form>
  );
}
