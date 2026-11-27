import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { translateError } from '../lib/errorMessages';
import { Button, Field } from '../components/Primitives';
import { AUTHENTICATOR_HINT, CodeInput, TwoFactorQr } from '../components/TwoFactorSetup';

export default function Login() {
  const { login, completeTwoFactor, isAuthenticated, ready } = useAuth();
  const [form, setForm] = useState({ mobile: '', password: '' });
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  // After the password, for an admin with two-step sign-in:
  // { twoFactor: 'verify' | 'setup', challengeToken, setup? }
  const [challenge, setChallenge] = useState(null);
  const [code, setCode] = useState('');

  if (ready && isAuthenticated) return <Navigate to="/" replace />;

  const submitCode = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await completeTwoFactor(challenge.challengeToken, code);
    } catch (apiError) {
      setCode('');
      // The five minutes ran out: back to the password.
      if (apiError?.code === 'TWO_FACTOR_CHALLENGE_EXPIRED') setChallenge(null);
      setError(translateError(apiError));
    } finally {
      setLoading(false);
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const result = await login(form.mobile.trim(), form.password);
      if (result?.twoFactor) {
        setCode('');
        setChallenge(result);
      }
    } catch (apiError) {
      setError(
        apiError?.code === 'FORBIDDEN' ? 'این حساب دسترسی مدیریت ندارد.' : translateError(apiError),
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card stack" onSubmit={challenge ? submitCode : submit}>
        <div className="row" style={{ gap: 10, marginBottom: 6 }}>
          {/* The gold mark on black, as the logo was drawn. */}
          <span
            style={{
              width: 52,
              height: 52,
              borderRadius: 14,
              background: 'var(--brand-900)',
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0,
            }}
          >
            <img src="/logo-mark.svg" alt="" width="40" height="27" />
          </span>
          <div>
            <div className="strong" style={{ fontSize: 17 }}>
              پنل مدیریت ماراتون پارتز
            </div>
            <div className="tiny muted">ورود مخصوص مدیران فروشگاه</div>
          </div>
        </div>

        {challenge ? (
          <TwoFactorStep
            challenge={challenge}
            code={code}
            setCode={setCode}
            error={error}
            loading={loading}
            onBack={() => {
              setChallenge(null);
              setError(null);
            }}
          />
        ) : (
          <>
            <Field label="شماره موبایل">
              <input
                className="input"
                inputMode="numeric"
                placeholder="09123456789"
                value={form.mobile}
                onChange={(event) =>
                  setForm((current) => ({ ...current, mobile: event.target.value }))
                }
                required
              />
            </Field>

            <Field label="رمز عبور">
              <input
                className="input"
                type="password"
                value={form.password}
                onChange={(event) =>
                  setForm((current) => ({ ...current, password: event.target.value }))
                }
                required
              />
            </Field>

            {error ? (
              <div
                className="small"
                style={{
                  color: 'var(--danger-600)',
                  background: 'var(--danger-50)',
                  padding: '9px 12px',
                  borderRadius: 9,
                }}
              >
                {error}
              </div>
            ) : null}

            <Button block loading={loading} type="submit">
              ورود به پنل
            </Button>
          </>
        )}
      </form>
    </div>
  );
}

function ErrorBox({ error }) {
  if (!error) return null;
  return (
    <div
      className="small"
      style={{
        color: 'var(--danger-600)',
        background: 'var(--danger-50)',
        padding: '9px 12px',
        borderRadius: 9,
      }}
    >
      {error}
    </div>
  );
}

// The second step: the code from the authenticator app - and, the first
// time, the QR code to add the account to the app.
function TwoFactorStep({ challenge, code, setCode, error, loading, onBack }) {
  const setup = challenge.twoFactor === 'setup' ? challenge.setup : null;
  return (
    <div className="stack" style={{ gap: 12 }}>
      {setup ? (
        <>
          <div className="small">
            ورود دومرحله‌ای برای مدیران این فروشگاه اجباری است. یک بار این کد را با برنامهٔ احراز
            هویت اسکن کنید ({AUTHENTICATOR_HINT})، بعد کد ۶ رقمی‌ای را که نشان می‌دهد وارد کنید.
          </div>
          <TwoFactorQr otpauthUrl={setup.otpauthUrl} secret={setup.secret} />
        </>
      ) : (
        <div className="small">کد ۶ رقمی برنامهٔ احراز هویت گوشی‌تان را وارد کنید.</div>
      )}
      <Field label="کد برنامهٔ احراز هویت">
        <CodeInput value={code} onChange={setCode} />
      </Field>
      <ErrorBox error={error} />
      <Button block loading={loading} type="submit" disabled={code.length !== 6}>
        {setup ? 'فعال‌سازی و ورود' : 'ورود به پنل'}
      </Button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>
        بازگشت به رمز عبور
      </button>
    </div>
  );
}
