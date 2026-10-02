import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { DiamondLogo } from "@/components/DiamondLogo";

export default function Splash() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const ref = searchParams.get("ref");
    if (ref) sessionStorage.setItem("referralCode", ref);
  }, [searchParams]);

  function go(path: string) {
    const ref =
      searchParams.get("ref") ?? sessionStorage.getItem("referralCode");
    navigate(ref ? `${path}?ref=${ref}` : path);
  }

  return (
    <div className="diamond-mesh flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <DiamondLogo size={80} showTagline />

      <div className="mt-10 w-full max-w-xs space-y-3">
        <button onClick={() => go("/register")} className="btn-primary w-full">
          Get started
        </button>
        <button onClick={() => go("/login")} className="btn-outline w-full">
          Sign in
        </button>
      </div>
    </div>
  );
}
