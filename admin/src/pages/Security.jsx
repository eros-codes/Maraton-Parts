import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, ShieldAlert } from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from '../context/ToastContext';
import { translateError } from '../lib/errorMessages';
import { Button, ConnectionError, Field } from '../components/Primitives';
import { AUTHENTICATOR_HINT, CodeInput, TwoFactorQr } from '../components/TwoFactorSetup';

// The signed-in admin's own two-step sign-in: on, off, or moved to a new
// phone. When the shop requires it for every admin it cannot be turned off
// here (the API refuses too).
export default function Security() {
  const toast = useToast();
  const [status, setStatus] = useState(null);
  const [failed, setFailed] = useState(false);
  // { secret, otpauthUrl } while a setup is waiting for its first code.
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [disabling, setDisabling] = useState(false);
  // Moving to a new phone: the current app's code comes first.
  const [moving, setMoving] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    api
      .get('/auth/2fa', { auth: true })
      .then(setStatus)
      .catch(() => setFailed(true));
  }, []);

  useEffect(load, [load]);

  const startSetup = async (event) => {
    event?.preventDefault();
    setBusy(true);
    try {
      setSetup(await api.post('/auth/2fa/setup', moving ? { code } : undefined, { auth: true }));
      setMoving(false);
      setCode('');
    } catch (error) {
      setCode('');
      toast.error(translateError(error));
    } finally {
      setBusy(false);
    }
  };

  const confirmSetup = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.post('/auth/2fa/enable', { code }, { auth: true });
      toast.success('ورود دومرحله‌ای فعال شد');
      setSetup(null);
      setCode('');
      load();
    } catch (error) {
      setCode('');
      toast.error(translateError(error));
    } finally {
      setBusy(false);
    }
  };

  const disable = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.post('/auth/2fa/disable', { password, code }, { auth: true });
      toast.success('ورود دومرحله‌ای خاموش شد');
      setDisabling(false);
      setPassword('');
      setCode('');
      load();
    } catch (error) {
      setCode('');
      toast.error(translateError(error));
    } finally {
      setBusy(false);
    }
  };

  if (failed) return <ConnectionError onRetry={load} />;
  if (!status) return null;

  return (
    <section className="card card-pad stack" style={{ maxWidth: 560, gap: 14 }}>
      <div className="row" style={{ gap: 10 }}>
        {status.enabled ? (
          <ShieldCheck size={22} color="var(--success-600)" />
        ) : (
          <ShieldAlert size={22} color="var(--danger-600)" />
        )}
        <div>
          <div className="strong">ورود دومرحله‌ای</div>
          <div className="small muted">
            {status.enabled
              ? 'روشن است: بعد از رمز عبور، کد ۶ رقمی برنامهٔ احراز هویت گوشی‌تان پرسیده می‌شود.'
              : 'خاموش است: هر کس رمز عبورتان را داشته باشد به کل پنل دسترسی دارد.'}
            {status.required ? ' برای همهٔ مدیران این فروشگاه اجباری است.' : ''}
          </div>
        </div>
      </div>

      {setup ? (
        <form className="stack" style={{ gap: 12 }} onSubmit={confirmSetup}>
          <div className="small">
            این کد را با برنامهٔ احراز هویت اسکن کنید ({AUTHENTICATOR_HINT}) و کد ۶ رقمی‌ای را که
            نشان می‌دهد وارد کنید.
            {status.enabled ? ' بعد از تأیید، برنامهٔ قبلی دیگر کار نمی‌کند.' : ''}
          </div>
          <TwoFactorQr otpauthUrl={setup.otpauthUrl} secret={setup.secret} />
          <Field label="کد برنامهٔ احراز هویت">
            <CodeInput value={code} onChange={setCode} />
          </Field>
          <div className="row" style={{ gap: 8 }}>
            <Button type="submit" loading={busy} disabled={code.length !== 6}>
              تأیید و فعال‌سازی
            </Button>
            <Button type="button" variant="ghost" onClick={() => setSetup(null)}>
              انصراف
            </Button>
          </div>
        </form>
      ) : moving ? (
        <form className="stack" style={{ gap: 12 }} onSubmit={startSetup}>
          <div className="small">اول کد فعلی برنامهٔ احراز هویت را از گوشی قبلی وارد کنید.</div>
          <Field label="کد فعلی">
            <CodeInput value={code} onChange={setCode} />
          </Field>
          <div className="row" style={{ gap: 8 }}>
            <Button type="submit" loading={busy} disabled={code.length !== 6}>
              ادامه
            </Button>
            <Button type="button" variant="ghost" onClick={() => setMoving(false)}>
              انصراف
            </Button>
          </div>
        </form>
      ) : disabling ? (
        <form className="stack" style={{ gap: 12 }} onSubmit={disable}>
          <Field label="رمز عبور فعلی">
            <input
              className="input"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </Field>
          <Field label="کد برنامهٔ احراز هویت">
            <CodeInput value={code} onChange={setCode} autoFocus={false} />
          </Field>
          <div className="row" style={{ gap: 8 }}>
            <Button
              type="submit"
              variant="danger"
              loading={busy}
              disabled={code.length !== 6 || !password}
            >
              خاموش کردن
            </Button>
            <Button type="button" variant="ghost" onClick={() => setDisabling(false)}>
              انصراف
            </Button>
          </div>
        </form>
      ) : (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {status.enabled ? (
            <Button
              onClick={() => {
                setCode('');
                setMoving(true);
              }}
            >
              انتقال به گوشی جدید
            </Button>
          ) : (
            <Button onClick={() => startSetup()} loading={busy}>
              فعال‌سازی ورود دومرحله‌ای
            </Button>
          )}
          {status.enabled && !status.required ? (
            <Button variant="ghost" onClick={() => setDisabling(true)}>
              خاموش کردن
            </Button>
          ) : null}
        </div>
      )}

      <p className="tiny muted" style={{ margin: 0 }}>
        اگر گوشی‌تان گم شد، مدیر دیگری از صفحهٔ «کاربران» ورود دومرحله‌ای شما را ریست می‌کند. اگر
        تنها مدیر هستید، روی سرور بزنید:{' '}
        <code dir="ltr">npm run admin:reset-2fa -- 09xxxxxxxxx</code>
      </p>
    </section>
  );
}
