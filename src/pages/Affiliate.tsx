import { useEffect, useState, type FormEvent } from "react";
import { Copy, Check } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { Layout } from "@/components/Layout";

interface AffiliateProfile {
  referral_code: string;
  status: "inactive" | "active";
  activated_at: string | null;
}
interface Balance {
  currency: "NGN" | "USD";
  total_earned: number;
  total_withdrawn: number;
  balance: number;
}
interface Commission {
  id: string;
  referred_user_id: string;
  commission_amount: number;
  commission_currency: string;
  status: string;
  created_at: string;
}
interface PayoutMethod {
  id: string;
  currency: "NGN" | "USD";
  method: string;
  bank_code: string | null;
  account_number: string | null;
  account_name: string | null;
}
interface Withdrawal {
  id: string;
  amount: number;
  currency: string;
  status: string;
  requested_at: string;
}

const MIN_WITHDRAWAL = { NGN: 10000, USD: 10 };

function randomCode(seed: string) {
  const base =
    seed
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 8) || "SCHOLAR";
  const suffix = Math.floor(1000 + Math.random() * 9000);
  return `${base}${suffix}`;
}

export default function Affiliate() {
  const { user, profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [affiliate, setAffiliate] = useState<AffiliateProfile | null>(null);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [payoutMethods, setPayoutMethods] = useState<PayoutMethod[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);

  const [methodForm, setMethodForm] = useState({
    currency: "NGN" as "NGN" | "USD",
    method: "bank_transfer",
    bankCode: "",
    accountNumber: "",
    accountName: "",
  });
  const [withdrawForm, setWithdrawForm] = useState({
    amount: "",
    currency: "NGN" as "NGN" | "USD",
    payoutMethodId: "",
  });

  async function load() {
    if (!user) return;
    setLoading(true);

    const { data: affiliateRow } = await supabase
      .from("affiliate_profiles")
      .select("referral_code, status, activated_at")
      .eq("user_id", user.id)
      .maybeSingle();
    setAffiliate(affiliateRow ?? null);

    if (affiliateRow) {
      const [
        { data: balanceRows },
        { data: commissionRows },
        { data: methodRows },
        { data: withdrawalRows },
      ] = await Promise.all([
        supabase.from("affiliate_balances").select("*").eq("user_id", user.id),
        supabase
          .from("commissions")
          .select(
            "id, referred_user_id, commission_amount, commission_currency, status, created_at",
          )
          .eq("referrer_user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(50),
        supabase
          .from("payout_methods")
          .select(
            "id, currency, method, bank_code, account_number, account_name",
          )
          .eq("user_id", user.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("withdrawals")
          .select("id, amount, currency, status, requested_at")
          .eq("user_id", user.id)
          .order("requested_at", { ascending: false })
          .limit(50),
      ]);

      setBalances(balanceRows ?? []);
      setCommissions(commissionRows ?? []);
      setPayoutMethods(methodRows ?? []);
      setWithdrawals(withdrawalRows ?? []);

      const referredIds = [
        ...new Set((commissionRows ?? []).map((c) => c.referred_user_id)),
      ];
      if (referredIds.length > 0) {
        const { data: nameRows } = await supabase.rpc("public_profile_names", {
          p_user_ids: referredIds,
        });
        setNames(
          new Map(
            (nameRows ?? []).map(
              (n: { user_id: string; display_name: string }) => [
                n.user_id,
                n.display_name,
              ],
            ),
          ),
        );
      }
    }

    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function becomeAffiliate() {
    if (!user) return;
    setActivating(true);
    setError(null);

    const seed =
      profile?.username ?? profile?.display_name ?? user.email ?? "scholar";
    for (let attempt = 0; attempt < 6; attempt++) {
      const { error: insertError } = await supabase
        .from("affiliate_profiles")
        .insert({
          user_id: user.id,
          referral_code: randomCode(seed),
          status: "active",
          activated_at: new Date().toISOString(),
        });
      if (!insertError) {
        await load();
        setActivating(false);
        return;
      }
      // 23505 = unique_violation — retry with a fresh random suffix on a referral_code
      // collision; any other error means something real is wrong, so stop and surface it.
      if (insertError.code !== "23505") {
        setError(insertError.message);
        setActivating(false);
        return;
      }
    }
    setError("Could not generate a unique referral code — please try again.");
    setActivating(false);
  }

  async function addPayoutMethod(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    setError(null);
    const { error: insertError } = await supabase
      .from("payout_methods")
      .insert({
        user_id: user.id,
        currency: methodForm.currency,
        method: methodForm.method,
        bank_code:
          methodForm.method === "bank_transfer" ? methodForm.bankCode : null,
        account_number: methodForm.accountNumber,
        account_name: methodForm.accountName,
      });
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setMethodForm({
      currency: "NGN",
      method: "bank_transfer",
      bankCode: "",
      accountNumber: "",
      accountName: "",
    });
    setInfo("Payout method added.");
    void load();
  }

  async function requestWithdrawal(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    setError(null);
    setInfo(null);

    const amount = Number(withdrawForm.amount);
    const min = MIN_WITHDRAWAL[withdrawForm.currency];
    if (!amount || amount < min) {
      setError(`Minimum withdrawal is ${min} ${withdrawForm.currency}.`);
      return;
    }
    const balance =
      balances.find((b) => b.currency === withdrawForm.currency)?.balance ?? 0;
    if (amount > balance) {
      setError(`You only have ${balance} ${withdrawForm.currency} available.`);
      return;
    }
    if (!withdrawForm.payoutMethodId) {
      setError("Add a payout method for this currency first.");
      return;
    }

    const { error: insertError } = await supabase.from("withdrawals").insert({
      user_id: user.id,
      amount,
      currency: withdrawForm.currency,
      payout_method_id: withdrawForm.payoutMethodId,
      status: "pending",
    });
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setWithdrawForm({
      amount: "",
      currency: withdrawForm.currency,
      payoutMethodId: "",
    });
    setInfo("Withdrawal requested — an admin will process it shortly.");
    void load();
  }

  const referralLink = affiliate
    ? `${window.location.origin}/register?ref=${affiliate.referral_code}`
    : "";

  function copyLink() {
    void navigator.clipboard.writeText(referralLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const methodsForWithdrawCurrency = payoutMethods.filter(
    (m) => m.currency === withdrawForm.currency,
  );

  if (loading) {
    return (
      <Layout title="Affiliate">
        <p className="text-sm text-text-3">Loading…</p>
      </Layout>
    );
  }

  if (!affiliate) {
    return (
      <Layout title="Affiliate">
        <div className="card-luxury p-6">
          <h2 className="font-heading text-lg font-bold text-text-1">
            Earn by referring friends
          </h2>
          <p className="mt-2 text-sm text-text-3">
            Share your personal link. When someone you refer pays for department
            access, you earn a 25% commission — paid out to your bank account or
            wallet once your balance clears the minimum withdrawal.
          </p>
          {error && (
            <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </p>
          )}
          <button
            onClick={() => void becomeAffiliate()}
            disabled={activating}
            className="btn-primary mt-4 w-full"
          >
            {activating ? "Activating…" : "Become an affiliate"}
          </button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Affiliate">
      <div className="card-luxury p-5">
        <p className="text-xs uppercase tracking-wide text-text-3">
          Your referral link
        </p>
        <div className="mt-2 flex items-center gap-2">
          <input
            readOnly
            value={referralLink}
            className="flex-1 rounded-xl border border-canvas-border bg-canvas-soft px-3 py-2 text-xs text-text-2"
          />
          <button onClick={copyLink} className="btn-secondary px-3 py-2">
            {copied ? <Check size={16} /> : <Copy size={16} />}
          </button>
        </div>
        <span className="badge-royal mt-3 inline-block">
          {affiliate.referral_code}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        {balances.length === 0 && (
          <p className="col-span-2 text-sm text-text-3">
            No earnings yet — share your link to get started.
          </p>
        )}
        {balances.map((b) => (
          <div key={b.currency} className="card-luxury p-4">
            <p className="text-xs uppercase tracking-wide text-text-3">
              {b.currency} balance
            </p>
            <p className="font-heading text-xl font-bold text-royal">
              {b.balance.toLocaleString()}
            </p>
            <p className="mt-1 text-xs text-text-3">
              Earned {b.total_earned.toLocaleString()} · Withdrawn{" "}
              {b.total_withdrawn.toLocaleString()}
            </p>
          </div>
        ))}
      </div>

      {info && (
        <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {info}
        </p>
      )}
      {error && (
        <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      )}

      <div className="card-luxury mt-4 p-5">
        <h2 className="font-heading text-sm font-bold text-text-1">
          Request a withdrawal
        </h2>
        <form onSubmit={requestWithdrawal} className="mt-3 space-y-3">
          <div className="flex gap-2">
            <select
              value={withdrawForm.currency}
              onChange={(e) =>
                setWithdrawForm((f) => ({
                  ...f,
                  currency: e.target.value as "NGN" | "USD",
                  payoutMethodId: "",
                }))
              }
              className={inputClass}
            >
              <option value="NGN">NGN</option>
              <option value="USD">USD</option>
            </select>
            <input
              type="number"
              placeholder="Amount"
              value={withdrawForm.amount}
              onChange={(e) =>
                setWithdrawForm((f) => ({ ...f, amount: e.target.value }))
              }
              className={inputClass}
            />
          </div>
          <select
            value={withdrawForm.payoutMethodId}
            onChange={(e) =>
              setWithdrawForm((f) => ({ ...f, payoutMethodId: e.target.value }))
            }
            className={inputClass}
          >
            <option value="">Select payout method</option>
            {methodsForWithdrawCurrency.map((m) => (
              <option key={m.id} value={m.id}>
                {m.method} · {m.account_number}
              </option>
            ))}
          </select>
          <button type="submit" className="btn-primary w-full">
            Request withdrawal
          </button>
        </form>
      </div>

      <div className="card-luxury mt-4 p-5">
        <h2 className="font-heading text-sm font-bold text-text-1">
          Add a payout method
        </h2>
        <form onSubmit={addPayoutMethod} className="mt-3 space-y-3">
          <div className="flex gap-2">
            <select
              value={methodForm.currency}
              onChange={(e) =>
                setMethodForm((f) => ({
                  ...f,
                  currency: e.target.value as "NGN" | "USD",
                }))
              }
              className={inputClass}
            >
              <option value="NGN">NGN</option>
              <option value="USD">USD</option>
            </select>
            <select
              value={methodForm.method}
              onChange={(e) =>
                setMethodForm((f) => ({ ...f, method: e.target.value }))
              }
              className={inputClass}
            >
              <option value="bank_transfer">Bank transfer</option>
              <option value="paypal">PayPal</option>
              <option value="usdt_trc20">USDT (TRC20)</option>
              <option value="intl_wire">International wire</option>
            </select>
          </div>
          {methodForm.method === "bank_transfer" && (
            <input
              placeholder="Bank code"
              value={methodForm.bankCode}
              onChange={(e) =>
                setMethodForm((f) => ({ ...f, bankCode: e.target.value }))
              }
              className={inputClass}
            />
          )}
          <input
            placeholder={
              methodForm.method === "paypal"
                ? "PayPal email"
                : methodForm.method === "usdt_trc20"
                  ? "Wallet address"
                  : "Account number"
            }
            value={methodForm.accountNumber}
            onChange={(e) =>
              setMethodForm((f) => ({ ...f, accountNumber: e.target.value }))
            }
            className={inputClass}
          />
          <input
            placeholder="Account name"
            value={methodForm.accountName}
            onChange={(e) =>
              setMethodForm((f) => ({ ...f, accountName: e.target.value }))
            }
            className={inputClass}
          />
          <button type="submit" className="btn-secondary w-full">
            Add payout method
          </button>
        </form>
      </div>

      <div className="card-luxury mt-4 p-5">
        <h2 className="font-heading text-sm font-bold text-text-1">
          Withdrawal history
        </h2>
        {withdrawals.length === 0 && (
          <p className="mt-2 text-sm text-text-3">No withdrawals yet.</p>
        )}
        <ul className="mt-2 divide-y divide-canvas-border">
          {withdrawals.map((w) => (
            <li
              key={w.id}
              className="flex items-center justify-between py-2 text-sm"
            >
              <span className="text-text-2">
                {w.amount.toLocaleString()} {w.currency}
              </span>
              <StatusBadge status={w.status} />
            </li>
          ))}
        </ul>
      </div>

      <div className="card-luxury mt-4 p-5">
        <h2 className="font-heading text-sm font-bold text-text-1">
          Referral earnings
        </h2>
        {commissions.length === 0 && (
          <p className="mt-2 text-sm text-text-3">No referral earnings yet.</p>
        )}
        <ul className="mt-2 divide-y divide-canvas-border">
          {commissions.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between py-2 text-sm"
            >
              <span className="text-text-2">
                {names.get(c.referred_user_id) ?? "A referral"}
              </span>
              <span className="font-semibold text-royal">
                +{c.commission_amount.toLocaleString()} {c.commission_currency}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Layout>
  );
}

function StatusBadge({ status }: { status: string }) {
  const classes =
    status === "success"
      ? "badge-royal"
      : status === "failed"
        ? "bg-rose-100 text-rose-700 rounded-full px-2.5 py-0.5 text-xs font-semibold"
        : "badge-gold";
  return <span className={classes}>{status}</span>;
}

const inputClass =
  "w-full rounded-xl border border-canvas-border bg-white px-3 py-2.5 text-sm text-text-1 transition-colors focus:border-royal focus:outline-none focus:ring-2 focus:ring-royal/15";
