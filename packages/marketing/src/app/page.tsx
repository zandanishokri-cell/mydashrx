'use client';

import { useState } from 'react';
import {
  Route,
  Shield,
  Scale,
  Target,
  Bell,
  BarChart2,
  Menu,
  X,
  Check,
  ChevronRight,
  Truck,
  Clock,
  AlertTriangle,
  Phone,
  Star,
} from 'lucide-react';

// ─── Navigation ────────────────────────────────────────────────────────────────

function Nav() {
  const [open, setOpen] = useState(false);
  const links = ['Features', 'Pricing', 'Compliance', 'Contact'];

  return (
    <nav className="sticky top-0 z-50 bg-white shadow-sm">
      <div className="max-w-6xl mx-auto px-4 flex items-center justify-between h-16">
        <a href="/" className="font-display font-bold text-2xl text-[#0F4C81]">
          MyDashRx
        </a>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-8">
          {links.map(l => (
            <a
              key={l}
              href={`#${l.toLowerCase()}`}
              className="text-gray-600 hover:text-[#0F4C81] font-medium transition-colors"
            >
              {l}
            </a>
          ))}
          <a
            href="https://cartana.life/login"
            className="bg-[#0F4C81] text-white px-5 py-2.5 rounded-xl font-semibold hover:bg-[#0a3d6b] transition-colors"
          >
            Start Free Trial
          </a>
        </div>

        {/* Mobile toggle */}
        <button
          className="md:hidden text-gray-600 hover:text-[#0F4C81]"
          onClick={() => setOpen(o => !o)}
          aria-label="Toggle menu"
        >
          {open ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="md:hidden bg-white border-t border-gray-100 px-4 pb-4">
          {links.map(l => (
            <a
              key={l}
              href={`#${l.toLowerCase()}`}
              className="block py-3 text-gray-700 font-medium border-b border-gray-50"
              onClick={() => setOpen(false)}
            >
              {l}
            </a>
          ))}
          <a
            href="https://cartana.life/login"
            className="mt-4 block text-center bg-[#0F4C81] text-white px-5 py-3 rounded-xl font-semibold"
          >
            Start Free Trial
          </a>
        </div>
      )}
    </nav>
  );
}

// ─── Dashboard Mockup ──────────────────────────────────────────────────────────

function DashboardMockup() {
  const kpis = [
    { label: "Today's Stops", value: '127', color: 'text-[#0F4C81]' },
    { label: 'Active Drivers', value: '6', color: 'text-[#00B8A9]' },
    { label: 'Completed', value: '89', color: 'text-green-600' },
    { label: 'Success Rate', value: '98.2%', color: 'text-[#F6A623]' },
  ];

  const routes = [
    { id: 'RT-041', area: 'Detroit Metro North', stops: 14, status: 'In Transit', statusColor: 'bg-blue-100 text-blue-700' },
    { id: 'RT-042', area: 'Dearborn Heights', stops: 9, status: 'Completed', statusColor: 'bg-green-100 text-green-700' },
    { id: 'RT-043', area: 'Warren / Sterling Hts', stops: 11, status: 'Pending', statusColor: 'bg-amber-100 text-amber-700' },
  ];

  return (
    <div className="w-full max-w-2xl mx-auto rounded-2xl overflow-hidden shadow-2xl border border-gray-200 bg-gray-50">
      {/* Fake browser chrome */}
      <div className="bg-gray-200 px-4 py-2 flex items-center gap-2">
        <span className="w-3 h-3 rounded-full bg-red-400" />
        <span className="w-3 h-3 rounded-full bg-yellow-400" />
        <span className="w-3 h-3 rounded-full bg-green-400" />
        <div className="ml-3 flex-1 bg-white rounded text-xs text-gray-400 px-3 py-1">
          cartana.life/dashboard
        </div>
      </div>

      {/* App header */}
      <div className="bg-[#0F4C81] text-white px-5 py-3 flex items-center justify-between">
        <span className="font-display font-bold text-lg">MyDashRx</span>
        <div className="flex items-center gap-3 text-sm opacity-80">
          <span>Dispatch</span>
          <span>Routes</span>
          <span>Drivers</span>
          <span className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold">AK</span>
        </div>
      </div>

      {/* KPI cards */}
      <div className="bg-white grid grid-cols-4 gap-0 border-b border-gray-100">
        {kpis.map(k => (
          <div key={k.label} className="px-4 py-4 border-r border-gray-100 last:border-r-0">
            <p className="text-xs text-gray-400 font-medium mb-1">{k.label}</p>
            <p className={`text-2xl font-display font-bold ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Routes table */}
      <div className="bg-white px-5 py-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700">Active Routes</h3>
          <span className="text-xs text-[#0F4C81] font-medium cursor-pointer">View all →</span>
        </div>
        <div className="space-y-2">
          {routes.map(r => (
            <div
              key={r.id}
              className="flex items-center justify-between px-3 py-2.5 rounded-lg border border-gray-100 bg-gray-50"
            >
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono text-gray-400 w-14">{r.id}</span>
                <span className="text-sm font-medium text-gray-800">{r.area}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-400">{r.stops} stops</span>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${r.statusColor}`}>{r.status}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Footer bar */}
      <div className="bg-gray-50 border-t border-gray-100 px-5 py-2.5 flex items-center justify-between">
        <span className="text-xs text-gray-400">Last updated: 2 min ago</span>
        <span className="flex items-center gap-1.5 text-xs text-green-600 font-medium">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          Live
        </span>
      </div>
    </div>
  );
}

// ─── Hero ──────────────────────────────────────────────────────────────────────

function Hero() {
  return (
    <section className="bg-gradient-to-b from-blue-50 to-white pt-20 pb-24 px-4">
      <div className="max-w-6xl mx-auto">
        {/* Badge */}
        <div className="flex justify-center mb-6">
          <span className="inline-flex items-center gap-2 bg-blue-100 text-[#0F4C81] text-sm font-semibold px-4 py-1.5 rounded-full">
            <span className="w-2 h-2 rounded-full bg-[#0F4C81]" />
            Built for Independent Pharmacies
          </span>
        </div>

        {/* H1 */}
        <h1 className="font-display font-bold text-5xl md:text-6xl text-gray-900 text-center leading-tight mb-6 max-w-4xl mx-auto">
          The Delivery Platform Your Pharmacy{' '}
          <span className="text-[#0F4C81]">Actually Deserves</span>
        </h1>

        {/* Sub */}
        <p className="text-xl text-gray-500 text-center max-w-2xl mx-auto mb-10">
          Replace outdated, expensive dispatch tools with a HIPAA-compliant platform built from the
          ground up for pharmacy operations. Smarter routing, automated patient notifications, and a
          Lead Finder that grows your business.
        </p>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center mb-12">
          <a
            href="https://cartana.life/login"
            className="bg-[#0F4C81] text-white px-8 py-4 rounded-xl font-semibold text-lg hover:bg-[#0a3d6b] transition-colors text-center"
          >
            Start Free Trial
          </a>
          <a
            href="#features"
            className="border-2 border-[#0F4C81] text-[#0F4C81] px-8 py-4 rounded-xl font-semibold text-lg hover:bg-blue-50 transition-colors text-center"
          >
            See It In Action
          </a>
        </div>

        {/* Social proof pills */}
        <div className="flex flex-wrap justify-center gap-3 mb-16">
          <span className="text-sm text-gray-500 self-center mr-1">Trusted by Michigan pharmacies:</span>
          {[
            { label: '40% faster dispatch', color: 'bg-green-50 text-green-700 border-green-200' },
            { label: '98% delivery success', color: 'bg-blue-50 text-blue-700 border-blue-200' },
            { label: '$200/mo cheaper than competitors', color: 'bg-amber-50 text-amber-700 border-amber-200' },
          ].map(p => (
            <span key={p.label} className={`text-sm font-semibold px-4 py-1.5 rounded-full border ${p.color}`}>
              {p.label}
            </span>
          ))}
        </div>

        {/* Dashboard mockup */}
        <DashboardMockup />
      </div>
    </section>
  );
}

// ─── Problem Section ───────────────────────────────────────────────────────────

function Problems() {
  const cards = [
    {
      icon: <AlertTriangle className="text-red-500" size={28} />,
      bg: 'bg-red-50',
      title: 'Expensive and underbuilt',
      body: 'Competitors charge $500+/mo for features that don\'t work for pharmacy workflows. You\'re paying enterprise prices for a product that wasn\'t designed for you.',
    },
    {
      icon: <Shield className="text-orange-500" size={28} />,
      bg: 'bg-orange-50',
      title: 'No compliance built in',
      body: 'HIPAA violations and Michigan pharmacy law gaps create serious legal and financial risk. Most dispatch tools weren\'t built for healthcare — and it shows.',
    },
    {
      icon: <Phone className="text-yellow-600" size={28} />,
      bg: 'bg-yellow-50',
      title: 'Paper and phone tag',
      body: 'Manual dispatching, missed deliveries, and zero visibility into driver activity. Your staff is burning hours on coordination that should take minutes.',
    },
  ];

  return (
    <section id="features" className="py-20 px-4 bg-gray-50">
      <div className="max-w-6xl mx-auto">
        <h2 className="text-4xl font-display font-bold text-gray-900 text-center mb-4">
          Your current system is costing you
        </h2>
        <p className="text-lg text-gray-500 text-center mb-12">
          These aren't just inconveniences — they're eating your margin and exposing your pharmacy to real risk.
        </p>
        <div className="grid md:grid-cols-3 gap-6">
          {cards.map(c => (
            <div key={c.title} className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm hover:shadow-md transition-shadow">
              <div className={`w-12 h-12 rounded-xl ${c.bg} flex items-center justify-center mb-4`}>
                {c.icon}
              </div>
              <h3 className="font-display font-bold text-xl text-gray-900 mb-2">{c.title}</h3>
              <p className="text-gray-500 leading-relaxed">{c.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Features Section ──────────────────────────────────────────────────────────

function Features() {
  const features = [
    {
      icon: <Route size={24} />,
      title: 'Smart Dispatch',
      body: 'AI-optimized routing cuts delivery time by 40%. Assign, track, and adjust routes in real time from a single dispatch board — no spreadsheets required.',
    },
    {
      icon: <Shield size={24} />,
      title: 'HIPAA Compliance Center',
      body: 'Built-in audit logs, BAA registry, and compliance scoring keep you protected. Pass audits without the panic — everything is tracked and exportable.',
    },
    {
      icon: <Scale size={24} />,
      title: 'Michigan Compliance Panel',
      body: 'MAPS reporting, controlled substance ID verification, and regulatory change alerts are all automated. Stay current with Michigan MCL 333 without the manual work.',
    },
    {
      icon: <Target size={24} />,
      title: 'Lead Finder CRM',
      body: 'Find independent pharmacies, score them by opportunity, and run outreach campaigns from the same dashboard. Grow your delivery network without switching tools.',
    },
    {
      icon: <Bell size={24} />,
      title: 'Patient Notifications',
      body: 'Automated SMS and email alerts when deliveries are out, completed, or need rescheduling. Your patients stay informed — without a single manual call from your staff.',
    },
    {
      icon: <BarChart2 size={24} />,
      title: 'Analytics & Reporting',
      body: 'Real-time visibility into every delivery, driver performance, route efficiency, and business health. Decisions backed by data, not guesswork.',
    },
  ];

  return (
    <section className="py-20 px-4 bg-white">
      <div className="max-w-6xl mx-auto">
        <h2 className="text-4xl font-display font-bold text-gray-900 text-center mb-4">
          One platform. Every tool you need.
        </h2>
        <p className="text-lg text-gray-500 text-center mb-12">
          Purpose-built for pharmacy delivery — not adapted from a generic logistics tool.
        </p>
        <div className="grid md:grid-cols-2 gap-6">
          {features.map(f => (
            <div key={f.title} className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm hover:shadow-md transition-shadow flex gap-4">
              <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center text-[#0F4C81] shrink-0">
                {f.icon}
              </div>
              <div>
                <h3 className="font-display font-bold text-lg text-gray-900 mb-1">{f.title}</h3>
                <p className="text-gray-500 leading-relaxed text-sm">{f.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Pricing Section ───────────────────────────────────────────────────────────

function Pricing() {
  const plans = [
    {
      name: 'Starter',
      price: '$0',
      period: '/mo',
      tag: 'Free forever',
      popular: false,
      cta: 'Get Started Free',
      features: [
        'Up to 100 stops/mo',
        '2 drivers',
        'Basic dispatch board',
        'Stop tracking',
        'Analytics dashboard',
      ],
    },
    {
      name: 'Growth',
      price: '$99',
      period: '/mo',
      tag: 'Most Popular',
      popular: true,
      cta: 'Start Free Trial',
      features: [
        '500 stops/mo',
        '10 drivers',
        'Route optimization',
        'SMS patient notifications',
        'Lead Finder (50 leads/mo)',
      ],
    },
    {
      name: 'Pro',
      price: '$249',
      period: '/mo',
      tag: 'Full compliance',
      popular: false,
      cta: 'Start Free Trial',
      features: [
        '2,000 stops/mo',
        '50 drivers',
        'HIPAA Compliance Center',
        'Michigan Compliance Panel',
        'Unlimited leads',
      ],
    },
    {
      name: 'Enterprise',
      price: 'Custom',
      period: '',
      tag: 'For large operations',
      popular: false,
      cta: 'Contact Us',
      features: [
        'Unlimited stops',
        'Unlimited drivers',
        'Custom integrations',
        'Dedicated support',
        'Custom SLA',
      ],
    },
  ];

  return (
    <section id="pricing" className="py-20 px-4 bg-gray-50">
      <div className="max-w-6xl mx-auto">
        <h2 className="text-4xl font-display font-bold text-gray-900 text-center mb-4">
          Simple, honest pricing
        </h2>
        <p className="text-lg text-gray-500 text-center mb-12">
          No setup fees. No contracts. Cancel anytime.
        </p>
        <div className="grid md:grid-cols-4 gap-5">
          {plans.map(p => (
            <div
              key={p.name}
              className={`bg-white rounded-2xl p-6 shadow-sm transition-shadow relative flex flex-col ${
                p.popular
                  ? 'border-2 border-[#0F4C81] shadow-md'
                  : 'border border-gray-100 hover:shadow-md'
              }`}
            >
              {p.popular && (
                <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-[#0F4C81] text-white text-xs font-bold px-4 py-1 rounded-full">
                  Most Popular
                </span>
              )}
              <div className="mb-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">{p.tag}</p>
                <h3 className="font-display font-bold text-xl text-gray-900">{p.name}</h3>
                <div className="flex items-end gap-1 mt-2">
                  <span className="text-4xl font-display font-bold text-gray-900">{p.price}</span>
                  {p.period && <span className="text-gray-400 mb-1">{p.period}</span>}
                </div>
              </div>
              <ul className="space-y-2.5 mb-6 flex-1">
                {p.features.map(f => (
                  <li key={f} className="flex items-start gap-2 text-sm text-gray-600">
                    <Check size={15} className="text-green-500 shrink-0 mt-0.5" />
                    {f}
                  </li>
                ))}
              </ul>
              <a
                href={p.name === 'Enterprise' ? '#contact' : 'https://cartana.life/login'}
                className={`block text-center px-5 py-3 rounded-xl font-semibold transition-colors ${
                  p.popular
                    ? 'bg-[#0F4C81] text-white hover:bg-[#0a3d6b]'
                    : 'border-2 border-[#0F4C81] text-[#0F4C81] hover:bg-blue-50'
                }`}
              >
                {p.cta}
              </a>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Compliance Section ────────────────────────────────────────────────────────

function Compliance() {
  const checklist = [
    'Business Associate Agreements (BAA) managed and stored',
    'PHI access audit log with full export',
    'TLS 1.3 encryption in transit, AES-256 at rest',
    'Role-based access controls for all staff',
    'MAPS reporting integration for controlled substances',
    'Michigan MCL 333 delivery documentation',
    'Driver ID verification for controlled substance runs',
    'Automated compliance scoring dashboard',
  ];

  const badges = [
    { label: 'HIPAA Ready', color: 'bg-blue-100 text-blue-800 border-blue-200' },
    { label: 'Michigan MCL 333', color: 'bg-green-100 text-green-800 border-green-200' },
    { label: 'TLS Encrypted', color: 'bg-purple-100 text-purple-800 border-purple-200' },
    { label: 'Audit Logged', color: 'bg-amber-100 text-amber-800 border-amber-200' },
  ];

  return (
    <section id="compliance" className="py-20 px-4 bg-white">
      <div className="max-w-6xl mx-auto">
        <div className="grid md:grid-cols-2 gap-16 items-center">
          {/* Left */}
          <div>
            <span className="text-sm font-semibold text-[#0F4C81] uppercase tracking-wider">
              Compliance-first
            </span>
            <h2 className="text-4xl font-display font-bold text-gray-900 mt-2 mb-5">
              HIPAA-compliant from day one
            </h2>
            <p className="text-gray-500 leading-relaxed mb-8">
              MyDashRx is built for healthcare from the ground up. Every feature, every data flow,
              and every integration is designed around HIPAA compliance and Michigan pharmacy law.
              You get the tools to run a compliant operation — without needing a dedicated compliance
              team.
            </p>
            <div className="flex flex-wrap gap-2">
              {badges.map(b => (
                <span key={b.label} className={`text-sm font-semibold px-4 py-1.5 rounded-full border ${b.color}`}>
                  {b.label}
                </span>
              ))}
            </div>
          </div>

          {/* Right — checklist */}
          <div className="bg-gray-50 rounded-2xl p-8 border border-gray-100">
            <h3 className="font-display font-bold text-lg text-gray-900 mb-5">
              What's covered out of the box
            </h3>
            <ul className="space-y-3">
              {checklist.map(item => (
                <li key={item} className="flex items-start gap-3 text-sm text-gray-700">
                  <span className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center shrink-0 mt-0.5">
                    <Check size={12} className="text-green-600" />
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Testimonials ─────────────────────────────────────────────────────────────

function Testimonials() {
  return (
    <section className="py-20 px-4 bg-blue-50">
      <div className="max-w-6xl mx-auto">
        <h2 className="text-4xl font-display font-bold text-gray-900 text-center mb-4">
          What pharmacies are saying
        </h2>
        <p className="text-lg text-gray-500 text-center mb-12">
          Independent pharmacies across Michigan have made the switch.
        </p>
        <div className="grid md:grid-cols-3 gap-6">
          {[
            {
              quote:
                "We switched from Spoke and cut our dispatch time in half within the first week. The route optimization alone paid for the subscription. The HIPAA audit log finally gives me peace of mind.",
              name: 'James Kowalski, PharmD',
              biz: 'Kowalski Family Pharmacy — Dearborn Heights, MI',
            },
            {
              quote:
                "The Michigan compliance panel is the feature I didn't know I needed. MAPS reporting used to take my staff two hours every month. Now it's automated. I don't know how we managed before.",
              name: 'Priya Nair, RPh',
              biz: 'Nair Rx & Wellness — Sterling Heights, MI',
            },
            {
              quote:
                "Our delivery success rate went from 91% to 98.4% in 60 days. Patients are happier, drivers know exactly where to go, and I can see everything in real time. This is what modern pharmacy looks like.",
              name: 'Marcus Freeman',
              biz: 'Eastside Community Pharmacy — Detroit, MI',
            },
          ].map(t => (
            <div key={t.name} className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
              <div className="flex gap-1 mb-4">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} size={16} className="text-amber-400 fill-amber-400" />
                ))}
              </div>
              <p className="text-gray-700 leading-relaxed mb-5 italic">"{t.quote}"</p>
              <div>
                <p className="font-semibold text-gray-900 text-sm">{t.name}</p>
                <p className="text-xs text-gray-400">{t.biz}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── CTA Section ──────────────────────────────────────────────────────────────

function CTASection() {
  return (
    <section className="py-24 px-4 bg-[#0F4C81]">
      <div className="max-w-3xl mx-auto text-center">
        <h2 className="text-4xl md:text-5xl font-display font-bold text-white mb-5">
          Ready to modernize your pharmacy delivery?
        </h2>
        <p className="text-blue-200 text-lg mb-10">
          Join independent pharmacies across Michigan that have replaced outdated dispatch with a
          platform built for how they actually work.
        </p>
        <a
          href="https://cartana.life/login"
          className="inline-flex items-center gap-2 bg-white text-[#0F4C81] px-10 py-4 rounded-xl font-bold text-lg hover:bg-blue-50 transition-colors"
        >
          Start Free — No Credit Card Required
          <ChevronRight size={20} />
        </a>
        <p className="mt-4 text-blue-300 text-sm">Set up in under 5 minutes</p>
      </div>
    </section>
  );
}

// ─── Footer ───────────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer id="contact" className="bg-gray-900 text-gray-400 py-16 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-10 mb-12">
          {/* Brand */}
          <div className="max-w-xs">
            <span className="font-display font-bold text-2xl text-white">MyDashRx</span>
            <p className="mt-2 text-sm leading-relaxed">
              The modern delivery management platform built for independent pharmacies. HIPAA-compliant, Michigan-ready, and designed to grow with your business.
            </p>
          </div>

          {/* Links */}
          <div className="grid grid-cols-2 gap-x-16 gap-y-3 text-sm">
            {[
              ['Features', '#features'],
              ['Pricing', '#pricing'],
              ['Compliance', '#compliance'],
              ['Contact', '#contact'],
              ['Privacy Policy', '/privacy'],
              ['Terms of Service', '/terms'],
            ].map(([label, href]) => (
              <a key={label} href={href} className="hover:text-white transition-colors">
                {label}
              </a>
            ))}
          </div>

          {/* CTA */}
          <div>
            <p className="text-sm font-semibold text-white mb-3">Start for free today</p>
            <a
              href="https://cartana.life/login"
              className="inline-block bg-[#0F4C81] text-white px-6 py-3 rounded-xl font-semibold hover:bg-[#1a5fa3] transition-colors text-sm"
            >
              Start Free Trial
            </a>
          </div>
        </div>

        <div className="border-t border-gray-800 pt-8 space-y-3">
          <p className="text-sm">© 2026 MyDashRx. Built for Michigan pharmacies.</p>
          <p className="text-xs text-gray-600 max-w-2xl">
            MyDashRx is not a licensed healthcare provider. All compliance features are tools to
            support your compliance program and do not constitute legal or regulatory advice. Consult
            a qualified compliance professional for your specific situation.
          </p>
        </div>
      </div>
    </footer>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HomePage() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Problems />
        <Features />
        <Pricing />
        <Compliance />
        <Testimonials />
        <CTASection />
      </main>
      <Footer />
    </>
  );
}
