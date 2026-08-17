import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Mail, CheckCircle } from 'lucide-react';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    await new Promise(r => setTimeout(r, 1200));
    setLoading(false);
    setSent(true);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-6">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <div className="card p-8 shadow-xl">
          <div className="flex justify-center mb-6">
            <img
              src="/images/logo-with-name.png"
              alt="PACE Consultant (P.) Ltd."
              className="h-16 w-auto object-contain"
            />
          </div>

          {!sent ? (
            <>
              <h1 className="text-2xl font-bold text-center text-slate-900 dark:text-white mb-2">Forgot Password?</h1>
              <p className="text-sm text-slate-500 text-center mb-6">
                Enter your email address and we'll send you a link to reset your password.
              </p>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    Email Address
                  </label>
                  <div className="relative">
                    <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder="you@company.com"
                      required
                      className="input pl-9"
                    />
                  </div>
                </div>

                <button type="submit" disabled={loading} className="btn-primary w-full py-2.5">
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Sending...
                    </span>
                  ) : 'Send Reset Link'}
                </button>
              </form>
            </>
          ) : (
            <div className="text-center">
              <div className="flex justify-center mb-4">
                <CheckCircle size={48} className="text-emerald-500" />
              </div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Email Sent!</h2>
              <p className="text-sm text-slate-500 mb-6">
                If <strong>{email}</strong> is registered, you'll receive a password reset link shortly.
              </p>
            </div>
          )}

          <div className="mt-6 text-center">
            <Link to="/login" className="inline-flex items-center gap-1.5 text-sm text-primary-500 hover:text-primary-600 font-medium">
              <ArrowLeft size={14} />
              Back to login
            </Link>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
