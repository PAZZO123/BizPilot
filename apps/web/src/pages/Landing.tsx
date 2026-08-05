import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart3,
  Box,
  Check,
  FileText,
  MessageSquare,
  Search,
  Smartphone,
  Wallet,
} from 'lucide-react';
import clsx from 'clsx';
import { api } from '../lib/api';
import { formatNumber } from '../lib/format';
import { HeroBackdrop } from '../components/HeroBackdrop';
import { ThemeToggle } from '../components/ThemeToggle';

interface Plan {
  id: string;
  name: string;
  tagline: string;
  priceRwf: number;
  priceUsd: number;
  highlights: string[];
}

const FEATURES = [
  {
    icon: Smartphone,
    title: 'Record a sale in seconds',
    body: 'Tap the products, take the money, done. Works on the cheapest Android phone, and the stock count moves by itself.',
  },
  {
    icon: Box,
    title: 'Never run out again',
    body: 'BizPilot tells you what is about to finish before the customer asks for it, and what is sitting on the shelf tying up your cash.',
  },
  {
    icon: BarChart3,
    title: 'Know your real profit',
    body: 'Not just what came in — what you actually kept, after what you paid for the goods and what you spend to keep the doors open.',
  },
  {
    icon: FileText,
    title: 'Invoices that get paid',
    body: 'Send a professional invoice with your name on it, and a link the customer can pay from their phone.',
  },
  {
    icon: MessageSquare,
    title: 'SMS reminders that work',
    body: 'People forget. BizPilot texts them politely so you do not have to make the awkward call.',
  },
  {
    icon: Search,
    title: 'Ask your business anything',
    body: '"What sells best on Saturdays?" "Who owes me money?" Get a straight answer from your own records, in your own words.',
  },
];

export function Landing() {
  const { data } = useQuery({
    queryKey: ['plans'],
    queryFn: async () => (await api.get<{ plans: Plan[] }>('/plans')).data.plans,
    staleTime: Infinity,
  });

  return (
    <div className="min-h-screen bg-white">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-700 text-sm font-bold text-white">
              BP
            </div>
            <span className="font-display text-xl font-bold text-slate-900">BizPilot</span>
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            <ThemeToggle />
            <Link to="/login" className="btn-ghost">
              Log in
            </Link>
            <Link to="/signup" className="btn-primary">
              Start free
            </Link>
          </div>
        </div>
      </header>

      {/* Hero — drifting shop scenes behind the headline. `isolate` keeps the
          backdrop's stacking context to itself so it can never rise over the
          sticky header. */}
      <section className="relative isolate overflow-hidden">
        <HeroBackdrop />

        <div className="relative mx-auto max-w-6xl px-4 py-20 sm:py-28">
          <div className="mx-auto max-w-3xl text-center">
            <span className="inline-flex rounded-full bg-white/15 px-3 py-1 text-sm font-semibold text-brand-100 ring-1 ring-inset ring-white/25 backdrop-blur">
              Built for shops in Rwanda
            </span>
            <h1 className="font-display mt-5 text-4xl font-bold leading-tight text-white drop-shadow-sm sm:text-6xl">
              Your notebook cannot tell you if you made money this month.
            </h1>
            <p className="mt-5 text-lg text-slate-200">
              BizPilot records your sales, watches your stock, chases your debtors and shows you
              your real profit — on the phone already in your pocket.
            </p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Link to="/signup" className="btn-primary px-6 py-3 text-base">
                Start free — no card needed
              </Link>
              {/* Not `btn-secondary` — that is a white button, which would
                  disappear into the pale parts of the photographs. */}
              <Link
                to="/login"
                className="btn border border-white/40 bg-white/10 px-6 py-3 text-base text-white backdrop-blur hover:bg-white/20"
              >
                See the demo shop
              </Link>
            </div>
            <p className="mt-3 text-sm text-slate-300">
              Free forever for a small shop. 14 days of everything to try it properly.
            </p>
          </div>
        </div>
      </section>

      {/* Problem framing — the reason someone changes what they do today. */}
      <section className="border-y border-slate-200 bg-slate-50 py-14">
        <div className="mx-auto max-w-5xl px-4">
          <h2 className="font-display text-center text-3xl font-bold text-slate-900">
            You already know these problems
          </h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {[
              ['The notebook got wet.', 'Three months of records, gone. BizPilot keeps them safe and searchable.'],
              ['You sold out on a Saturday.', "Your best day, and the shelf was empty. BizPilot warns you on Thursday."],
              ['Nobody knows who owes what.', 'BizPilot keeps the list, and texts them for you.'],
            ].map(([title, body]) => (
              <div key={title} className="card p-5">
                <p className="font-semibold text-slate-900">{title}</p>
                <p className="mt-2 text-sm text-slate-600">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="font-display text-center text-3xl font-bold text-slate-900 sm:text-4xl">
          Everything a small business actually needs
        </h2>
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <div key={feature.title}>
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                <feature.icon className="h-5 w-5" />
              </div>
              <h3 className="mt-3 font-semibold text-slate-900">{feature.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{feature.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing — rendered from the same plan definitions the API enforces. */}
      <section id="pricing" className="border-t border-slate-200 bg-slate-50 py-16">
        <div className="mx-auto max-w-5xl px-4">
          <h2 className="font-display text-center text-3xl font-bold text-slate-900 sm:text-4xl">
            Honest pricing
          </h2>
          <p className="mt-2 text-center text-slate-600">
            Start free. Upgrade when BizPilot is making you more than it costs.
          </p>

          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {data?.map((plan) => (
              <div
                key={plan.id}
                className={clsx(
                  'card flex flex-col p-6',
                  plan.id === 'starter' && 'ring-2 ring-brand-600',
                )}
              >
                {plan.id === 'starter' && (
                  <span className="mb-3 inline-flex w-fit rounded-full bg-brand-700 px-2.5 py-0.5 text-xs font-semibold text-white">
                    Most shops choose this
                  </span>
                )}
                <h3 className="text-lg font-bold text-slate-900">{plan.name}</h3>
                <p className="mt-1 text-sm text-slate-500">{plan.tagline}</p>
                <p className="mt-4">
                  <span className="text-3xl font-bold text-slate-900">
                    {plan.priceRwf === 0 ? 'Free' : `RWF ${formatNumber(plan.priceRwf)}`}
                  </span>
                  {plan.priceRwf > 0 && <span className="text-sm text-slate-500"> /month</span>}
                </p>
                {plan.priceUsd > 0 && (
                  <p className="text-xs text-slate-400">or ${plan.priceUsd}/month outside Rwanda</p>
                )}

                <ul className="mt-5 flex-1 space-y-2">
                  {plan.highlights.map((line) => (
                    <li key={line} className="flex gap-2 text-sm text-slate-700">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
                      {line}
                    </li>
                  ))}
                </ul>

                <Link
                  to="/signup"
                  className={clsx('mt-6', plan.id === 'starter' ? 'btn-primary' : 'btn-secondary')}
                >
                  {plan.priceRwf === 0 ? 'Start free' : `Try ${plan.name} free`}
                </Link>
              </div>
            ))}
          </div>

          <p className="mt-8 text-center text-sm text-slate-500">
            Pay with MTN MoMo, Airtel Money or card. Cancel any time — your data stays yours.
          </p>
        </div>
      </section>

      {/* Close */}
      <section className="mx-auto max-w-3xl px-4 py-16 text-center">
        <Wallet className="mx-auto h-10 w-10 text-brand-600" />
        <h2 className="font-display mt-4 text-3xl font-bold text-slate-900 sm:text-4xl">
          Find out what your shop actually earns
        </h2>
        <p className="mt-3 text-slate-600">
          Setting up takes about five minutes. Add your products, record one sale, and you will see
          the difference immediately.
        </p>
        <Link to="/signup" className="btn-primary mt-6 px-6 py-3 text-base">
          Create my free account
        </Link>
      </section>

      <footer className="border-t border-slate-200 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 text-sm text-slate-500 sm:flex-row">
          <span>© {new Date().getFullYear()} BizPilot</span>
          <div className="flex gap-4">
            <a href="#pricing" className="hover:text-slate-900">
              Pricing
            </a>
            <Link to="/login" className="hover:text-slate-900">
              Log in
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
