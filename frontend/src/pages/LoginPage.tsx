import { useState } from "react";
import nibrasLogo from "../assets/nibras-logo.png";

function RobotIllustration() {
  return (
    <svg
      width="280"
      height="200"
      viewBox="0 0 280 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect
        x="60"
        y="10"
        width="160"
        height="90"
        rx="12"
        fill="white"
        fillOpacity="0.9"
      />
      <rect x="75" y="28" width="80" height="6" rx="3" fill="#dbeafe" />
      <rect x="75" y="42" width="60" height="6" rx="3" fill="#dbeafe" />
      <rect x="75" y="56" width="100" height="6" rx="3" fill="#dbeafe" />
      <rect x="75" y="70" width="40" height="6" rx="3" fill="#dbeafe" />
      <rect x="175" y="50" width="8" height="26" rx="2" fill="#3b82f6" />
      <rect x="187" y="40" width="8" height="36" rx="2" fill="#60a5fa" />
      <rect x="199" y="55" width="8" height="21" rx="2" fill="#93c5fd" />
      <ellipse cx="140" cy="170" rx="45" ry="20" fill="#dbeafe" />
      <rect
        x="110"
        y="110"
        width="60"
        height="55"
        rx="16"
        stroke="#bfdbfe"
        strokeWidth="2"
        fill="white"
      />
      <rect
        x="115"
        y="80"
        width="50"
        height="38"
        rx="14"
        stroke="#bfdbfe"
        strokeWidth="2"
        fill="white"
      />
      <circle cx="132" cy="97" r="5" fill="#3b82f6" />
      <circle cx="148" cy="97" r="5" fill="#3b82f6" />
      <circle cx="133" cy="96" r="1.5" fill="white" />
      <circle cx="149" cy="96" r="1.5" fill="white" />
      <line
        x1="140"
        y1="80"
        x2="140"
        y2="70"
        stroke="#93c5fd"
        strokeWidth="2"
      />
      <circle cx="140" cy="68" r="4" fill="#3b82f6" />
      <rect
        x="95"
        y="120"
        width="18"
        height="8"
        rx="4"
        stroke="#bfdbfe"
        strokeWidth="1.5"
        fill="white"
      />
      <rect
        x="167"
        y="120"
        width="18"
        height="8"
        rx="4"
        stroke="#bfdbfe"
        strokeWidth="1.5"
        fill="white"
      />
      <circle cx="50" cy="60" r="6" fill="#3b82f6" fillOpacity="0.3" />
      <circle cx="230" cy="80" r="8" fill="#3b82f6" fillOpacity="0.2" />
      <circle cx="240" cy="40" r="4" fill="#60a5fa" fillOpacity="0.4" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#9ca3af"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#4b5563"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#4b5563"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function FeatureIcon({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100">
      {children}
    </div>
  );
}

export default function LoginPage() {
  const [activeTab, setActiveTab] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
  };

  return (
    <div className="relative flex min-h-screen font-sans">
      {/* Language selector — top-right of the whole page */}
      <div className="absolute top-5 right-6 z-10">
        <button className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-600 shadow-sm hover:bg-gray-50">
          <GlobeIcon />
          <span>Fran&ccedil;ais</span>
          <ChevronDownIcon />
        </button>
      </div>

      {/* Left Panel */}
      <div className="hidden w-[46%] flex-col justify-between bg-gradient-to-br from-blue-50 via-blue-50 to-blue-100 p-10 lg:flex">
        <div>
          {/* Logo + version */}
          <div className="mb-10 flex items-center gap-2">
            <img src={nibrasLogo} alt="Nibras" className="h-9" />
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-600">
              V1.1
            </span>
          </div>

          {/* Heading */}
          <h1 className="mb-4 text-[28px] leading-tight font-bold tracking-tight text-gray-900">
            Votre copilote IA pour
            <br />
            <span className="text-blue-600">une delivery intelligente</span>
          </h1>

          {/* Description */}
          <p className="mb-8 max-w-md text-[13px] leading-relaxed text-gray-500">
            Nibras analyse vos donn&eacute;es, anticipe les risques et vous aide
            &agrave; livrer vos projets plus vite, avec moins de blocages et
            plus d&rsquo;impact.
          </p>

          {/* Features */}
          <div className="space-y-5">
            <div className="flex items-start gap-3">
              <FeatureIcon>
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#2563eb"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                </svg>
              </FeatureIcon>
              <div>
                <p className="text-sm font-semibold text-gray-800">
                  Insights IA en temps r&eacute;el
                </p>
                <p className="text-xs leading-relaxed text-gray-500">
                  Des analyses et recommandations instantan&eacute;es pour
                  chaque d&eacute;cision.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <FeatureIcon>
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#2563eb"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </FeatureIcon>
              <div>
                <p className="text-sm font-semibold text-gray-800">
                  Moins de risques, plus de visibilit&eacute;
                </p>
                <p className="text-xs leading-relaxed text-gray-500">
                  Anticipez les d&eacute;rives et gardez le contr&ocirc;le sur
                  vos livrables.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <FeatureIcon>
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#2563eb"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </FeatureIcon>
              <div>
                <p className="text-sm font-semibold text-gray-800">
                  Collaboration ax&eacute;e sur la valeur
                </p>
                <p className="text-xs leading-relaxed text-gray-500">
                  Alignez vos &eacute;quipes autour de ce qui compte vraiment.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom: Robot + tagline */}
        <div>
          <div className="mb-4 flex justify-center">
            <RobotIllustration />
          </div>
          <p className="text-center text-xs leading-relaxed text-gray-500">
            Des &eacute;quipes plus align&eacute;es, des d&eacute;cisions plus
            &eacute;clair&eacute;es,
            <br />
            des livraisons qui comptent vraiment
          </p>
        </div>
      </div>

      {/* Right Panel */}
      <div className="flex w-full flex-col items-center justify-center bg-white px-6 py-10 lg:w-[54%]">
        {/* Card */}
        <div className="w-full max-w-[420px] rounded-2xl border border-gray-100 bg-white px-8 py-8 shadow-[0_4px_32px_rgba(0,0,0,0.06)]">
          {/* Tabs */}
          <div className="mb-7 flex justify-center gap-8 border-b border-gray-200">
            <button
              onClick={() => setActiveTab("login")}
              className={`pb-3 text-sm font-medium transition-colors ${
                activeTab === "login"
                  ? "border-b-2 border-blue-600 text-blue-600"
                  : "text-gray-400 hover:text-gray-600"
              }`}
            >
              Connexion
            </button>
            <button
              onClick={() => setActiveTab("register")}
              className={`pb-3 text-sm font-medium transition-colors ${
                activeTab === "register"
                  ? "border-b-2 border-blue-600 text-blue-600"
                  : "text-gray-400 hover:text-gray-600"
              }`}
            >
              Inscription
            </button>
          </div>

          {/* Welcome */}
          <h2 className="mb-1.5 text-xl font-bold text-gray-900">
            Bienvenue de retour !
          </h2>
          <p className="mb-6 text-[13px] text-gray-500">
            Connectez-vous pour retrouver vos projets et vos insights.
          </p>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email */}
            <div>
              <label
                htmlFor="email"
                className="mb-1.5 block text-[13px] font-medium text-gray-700"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="votreemail@exemple.com"
                className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </div>

            {/* Password */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label
                  htmlFor="password"
                  className="text-[13px] font-medium text-gray-700"
                >
                  Mot de passe
                </label>
                <a
                  href="#"
                  className="text-xs font-medium text-blue-600 hover:text-blue-700"
                >
                  Mot de passe oubli&eacute; ?
                </a>
              </div>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </div>

            {/* Submit */}
            <button
              type="submit"
              className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus:ring-2 focus:ring-blue-300 focus:ring-offset-2"
            >
              Se connecter
            </button>
          </form>

          {/* Divider */}
          <div className="my-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-gray-200" />
            <span className="text-xs text-gray-400">ou</span>
            <div className="h-px flex-1 bg-gray-200" />
          </div>

          {/* Google */}
          <button className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-gray-300 bg-white py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50">
            <GoogleIcon />
            Continuer avec Google
          </button>

          {/* Security */}
          <div className="mt-5 flex items-center justify-center gap-1.5 text-xs text-gray-400">
            <LockIcon />
            <span>S&eacute;curit&eacute; &amp; confidentialit&eacute;</span>
          </div>
        </div>

        {/* Footer — below the card */}
        <div className="mt-6 text-center">
          <p className="mb-1.5 text-[11px] leading-relaxed text-gray-400">
            En vous connectant, vous acceptez nos{" "}
            <a href="#" className="text-blue-600 underline hover:text-blue-700">
              Conditions d&rsquo;utilisation
            </a>{" "}
            et notre{" "}
            <a href="#" className="text-blue-600 underline hover:text-blue-700">
              Politique de confidentialit&eacute;
            </a>
            .
          </p>
          <p className="text-[11px] text-gray-400">
            &copy; 2026 Nibras. Tous droits r&eacute;serv&eacute;s.
          </p>
        </div>
      </div>
    </div>
  );
}
