window.__scriptLoaded = true;

const STORAGE_KEY = 'stationery-budget-v1';

let isFirestoreReady = false;
let currentUser = null;

function localDateStr(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function computeDateGroup(dateStr) {
  if (!dateStr) return 'Other';
  const today = new Date();
  const todayStr = localDateStr(today);
  const d = new Date(dateStr + 'T12:00:00');
  if (dateStr === todayStr) return 'Today';
  const y = new Date(today);
  y.setDate(y.getDate() - 1);
  if (dateStr === localDateStr(y)) return 'Yesterday';
  const diff = Math.floor((today - d) / (86400000));
  if (diff <= 7) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

const state = {
  activeScreen: 'welcome-screen',
  txType: 'Expense',
  selectedCategory: 'Food',
  editTransactionId: null,
  filters: {
    maxAmount: 0,
    categories: new Set(['All']),
    date: 'This Month'
  },
  analyticsPeriod: 'Month',
  trendView: 'line',
  dismissedAlerts: new Set(),
  excludedTransactions: new Set(),
  recurringTransactions: new Set(),
  selectedTransactionId: null,
  reducedMotion: false,
  darkMode: false,
  currency: 'EUR',
  notifications: true,
  bankSync: true,
  budgetTargets: { needs: 50, wants: 30, investments: 20 },
  budgetTolerance: 3,
  defaultPaymentSource: 'Revolut',
  defaultBudgetCategory: 'Needs',
  monthlyIncome: 0,
  goals: [],
  filterMaxAmount: 2200,
  holdHintShown: false
};

const currencySymbols = { USD: '$', EUR: '€', GBP: '£', CZK: 'Kč', PLN: 'zł' };

function currencySymbol() { return currencySymbols[state.currency] || '€'; }

function fmt(n) { return currencySymbol() + Number(n).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}); }

function fmtShort(n) { return currencySymbol() + Number(n).toLocaleString('en-US'); }

let budgetData = {
  totalBudget: 0,
  remaining: 0,
  segments: [
    { name: 'Needs', percentage: 0, spent: 0, color: 'var(--color-accent-needs)' },
    { name: 'Wants', percentage: 0, spent: 0, color: 'var(--color-accent-wants)' },
    { name: 'Investments', percentage: 0, spent: 0, color: 'var(--color-accent-savings)' }
  ]
};

const cashFlowData = [];

const trendMonthlyData = [];

const alerts = [];

let categoryBreakdown = [];

const transactions = [];

const filtersMetaCategories = ['All', 'Food', 'Transport', 'Shopping', 'Dining', 'Entertainment', 'Travel', 'Utilities', 'Other'];
const addCategories = ['Food', 'Groceries', 'Dining', 'Coffee', 'Bakery', 'Delivery', 'Transport', 'Fuel', 'Parking', 'Public Transit', 'Ride Share', 'Shopping', 'Clothing', 'Electronics', 'Home Goods', 'Beauty', 'Gifts', 'Pets', 'Entertainment', 'Streaming', 'Gaming', 'Movies', 'Music', 'Books', 'Sports', 'Travel', 'Hotels', 'Flights', 'Utilities', 'Phone', 'Internet', 'Insurance', 'Subscriptions', 'Rent', 'Health', 'Pharmacy', 'Gym', 'Doctor', 'Dental', 'Wellness', 'Education', 'Childcare', 'Other'];
const categoryGroups = [
  { name: 'Food & Dining', cats: ['Food', 'Groceries', 'Dining', 'Coffee', 'Bakery', 'Delivery'] },
  { name: 'Transport', cats: ['Transport', 'Fuel', 'Parking', 'Public Transit', 'Ride Share'] },
  { name: 'Shopping', cats: ['Shopping', 'Clothing', 'Electronics', 'Home Goods', 'Beauty', 'Gifts', 'Pets'] },
  { name: 'Entertainment', cats: ['Entertainment', 'Streaming', 'Gaming', 'Movies', 'Music', 'Books', 'Sports'] },
  { name: 'Travel', cats: ['Travel', 'Hotels', 'Flights'] },
  { name: 'Bills & Utilities', cats: ['Utilities', 'Phone', 'Internet', 'Insurance', 'Subscriptions', 'Rent'] },
  { name: 'Health', cats: ['Health', 'Pharmacy', 'Gym', 'Doctor', 'Dental', 'Wellness'] },
  { name: 'Other', cats: ['Education', 'Childcare', 'Other'] },
];

document.addEventListener('DOMContentLoaded', async () => {
  state.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  loadStorage();
  processRecurringTransactions();
  applyTheme();

  // Hide loading screen as soon as any screen becomes active
  const loadingEl = document.getElementById('loading-screen');
  function hideLoading() {
    if (loadingEl) loadingEl.classList.add('hidden');
  }
  const screenObserver = new MutationObserver(() => {
    if (document.querySelector('.screen.active')) {
      hideLoading();
      screenObserver.disconnect();
    }
  });
  const appEl = document.getElementById('app');
  if (appEl) screenObserver.observe(appEl, { attributes: true, subtree: true, attributeFilter: ['class'] });

  // Fallback: hide loading after 5s even if no screen activates
  setTimeout(hideLoading, 5000);

  // Helper: promise with timeout to prevent hanging on native bridge calls
  function withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
    ]);
  }

  // Load welcomeSeen — check Capacitor Preferences first, fallback to localStorage
  window._welcomeSeen = localStorage.getItem('welcomeSeen');
  try {
    const { value } = await withTimeout(
      window.Capacitor?.Plugins?.Preferences?.get({ key: 'welcomeSeen' }) || Promise.resolve({ value: null }),
      2000,
    );
    if (value) window._welcomeSeen = value;
  } catch {}

  // ====== FIREBASE AUTH & PROFILE (merged from second listener) ======
  const authScreen = document.getElementById('auth-screen');
  const authSegmentBtns = document.querySelectorAll('#auth-segment button');
  const authForm = document.getElementById('auth-form');
  const authName = document.getElementById('auth-name');
  const authEmail = document.getElementById('auth-email');
  const authPassword = document.getElementById('auth-password');
  const authSubmitBtn = document.getElementById('auth-submit-btn');
  const authError = document.getElementById('auth-error');
  const tabBar = document.getElementById('tab-bar');
  const fab = document.getElementById('fab');
  const greetingText = document.getElementById('greeting-text');
  const avatarEl = document.querySelector('.avatar');
  
  const profileNameInput = document.getElementById('profile-name-input');
  const profileEmailInput = document.getElementById('profile-email-input');
  const logoutBtn = document.getElementById('logout-btn');
  const googleSignInBtn = document.getElementById('google-signin-btn');

  let authMode = 'login';

  // Rate limiting for auth attempts
  let authAttempts = 0;
  let authBlockedUntil = 0;
  const BACKOFF_SCHEDULE = [0, 0, 0, 0, 0, 10000, 30000, 60000, 300000];

  // MFA state
  let mfaFactorId = null;
  let mfaChallengeId = null;

  // Auth globals
  let auth = null;
  
  try { auth = window.supabase ? window.supabase.auth : null; } catch(e) { _s && _s('Supabase err: ' + e.message); }
  async function registerNativePush(user) {
    if (!user) return;
    try {
      if (!window.Capacitor?.isPluginAvailable?.('PushNotifications')) return;
      const perm = await window.Capacitor.Plugins.PushNotifications.checkPermissions();
      if (perm.receive === 'prompt') {
        const p = await window.Capacitor.Plugins.PushNotifications.requestPermissions();
        if (p.receive !== 'granted') return;
      } else if (perm.receive !== 'granted') {
        return;
      }
      await window.Capacitor.Plugins.PushNotifications.register();
      window.Capacitor.Plugins.PushNotifications.addListener('registration', (r) => {
        const platform = window.Capacitor.getPlatform() === 'ios' ? 'ios' : 'android';
        sb.addDeviceToken(user.uid, r.value, platform);
      });
      window.Capacitor.Plugins.PushNotifications.addListener('pushNotificationReceived', (n) => {
        const { title, body } = n;
        if (title) showToast(`${title}: ${body || ''}`, 'info');
      });
    } catch (err) {
      console.error('Push registration failed:', err);
    }
  }

  function validatePassword(pw) {
    const errors = [];
    if (pw.length < 8) errors.push('At least 8 characters');
    if (!/[A-Z]/.test(pw)) errors.push('One uppercase letter');
    if (!/[a-z]/.test(pw)) errors.push('One lowercase letter');
    if (!/[0-9]/.test(pw)) errors.push('One digit');
    if (!/[^A-Za-z0-9]/.test(pw)) errors.push('One special character');
    return errors;
  }

  // Initially hide tab bar and fab until auth state is known
  tabBar.style.display = 'none';
  fab.style.display = 'none';

  function setAuthBusy(isBusy) {
    authSubmitBtn.disabled = isBusy;
    if (googleSignInBtn) googleSignInBtn.disabled = isBusy;
  }

  async function ensureUserProfile(user) {
    sb.updateProfileName(user.uid, user.displayName || 'User').catch(() => {});
  }

  const authPwConfirm = document.getElementById('auth-password-confirm');
  const authPwErrors = document.getElementById('auth-pw-errors');

  authSegmentBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      haptic('light');
      authSegmentBtns.forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      authMode = e.target.dataset.mode;
      authSubmitBtn.textContent = authMode === 'login' ? 'Login' : 'Sign Up';
      authName.style.display = authMode === 'login' ? 'none' : 'block';
      if (authPwConfirm) authPwConfirm.style.display = authMode === 'login' ? 'none' : 'block';
      if (authPwErrors) authPwErrors.textContent = '';
      if (authMode === 'signup') authName.required = true;
      else authName.required = false;
      authError.textContent = '';
    });
  });

  authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    haptic('medium');
    authError.textContent = '';
    if (authPwErrors) authPwErrors.textContent = '';

    // Rate limit check
    const now = Date.now();
    if (authBlockedUntil > now) {
      const waitSec = Math.ceil((authBlockedUntil - now) / 1000);
      authError.textContent = `Too many attempts. Try again in ${waitSec}s.`;
      return;
    }

    const email = authEmail.value;
    const password = authPassword.value;
    const name = authName.value;

    // Password validation for signup
    if (authMode === 'signup') {
      const pwErrors = validatePassword(password);
      if (authPwConfirm && password !== authPwConfirm.value) {
        pwErrors.push('Passwords do not match');
      }
      if (pwErrors.length > 0) {
        if (authPwErrors) authPwErrors.textContent = '• ' + pwErrors.join('\n• ');
        return;
      }
    }

    try {
      setAuthBusy(true);
      authSubmitBtn.textContent = 'Please wait...';
      if (authMode === 'login') {
        const { data, error } = await auth.signInWithPassword({ email, password });
        if (error) throw error;
        // Check if MFA is needed
        if (data?.user && !data.session) {
          const factors = await auth.mfa.list();
          if (factors?.data?.all?.length > 0) {
            mfaFactorId = factors.data.totp?.[0]?.id || factors.data.all[0].id;
            showMFAChallenge();
            return;
          }
        }
        authAttempts = 0;
      } else {
        const { data, error } = await auth.signUp({
          email, password,
          options: { data: { full_name: name } }
        });
        if (error) throw error;
        if (data?.user && !data?.session) {
          authError.textContent = 'Check your email for a confirmation link.';
          authSubmitBtn.textContent = 'Sign Up';
          setAuthBusy(false);
          return;
        }
        if (data?.user) {
          sb.updateProfileName(data.user.id, name).catch(() => {});
        }
        authAttempts = 0;
      }
    } catch (err) {
      authAttempts++;
      const idx = Math.min(authAttempts, BACKOFF_SCHEDULE.length - 1);
      if (BACKOFF_SCHEDULE[idx] > 0) {
        authBlockedUntil = Date.now() + BACKOFF_SCHEDULE[idx];
      }
      authError.textContent = err.message;
      authSubmitBtn.textContent = authMode === 'login' ? 'Login' : 'Sign Up';
    } finally {
      setAuthBusy(false);
    }
  });

  if (googleSignInBtn) {
    googleSignInBtn.addEventListener('click', async () => {
      haptic('medium');
      authError.textContent = '';
      try {
        setAuthBusy(true);
        googleSignInBtn.textContent = 'Please wait...';

        if (window.Capacitor?.isNativePlatform?.() && window.Capacitor.Plugins.GoogleAuth) {
          await window.Capacitor.Plugins.GoogleAuth.initialize();
          const result = await window.Capacitor.Plugins.GoogleAuth.signIn();
          const idToken = result.authentication?.idToken;
          if (!idToken) throw new Error('No ID token from Google');
          const { error } = await auth.signInWithIdToken({
            provider: 'google',
            token: idToken,
          });
          if (error) throw error;
        } else {
          await auth.signInWithOAuth({
            provider: 'google',
            options: {
              redirectTo: window.location.origin,
              queryParams: { prompt: 'select_account' }
            }
          });
        }
      } catch (err) {
        console.error('Google Sign-In error:', err);
        authError.textContent = err.message;
      } finally {
        googleSignInBtn.innerHTML = '<i class="ph ph-google-logo"></i>Sign in with Google';
        setAuthBusy(false);
      }
    });
  }

  // ====== MFA Functions ======
  async function showMFAEnrollment() {
    const mfaScreen = document.getElementById('mfa-screen');
    const enrollDiv = document.getElementById('mfa-enroll');
    const challengeDiv = document.getElementById('mfa-challenge');
    const recoveryDiv = document.getElementById('mfa-recovery');
    if (!mfaScreen) return;
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    mfaScreen.classList.add('active');
    if (enrollDiv) enrollDiv.style.display = 'block';
    if (challengeDiv) challengeDiv.style.display = 'none';
    if (recoveryDiv) recoveryDiv.style.display = 'none';

    try {
      const { data, error } = await auth.mfa.enroll({ factorType: 'totp' });
      if (error) throw error;
      mfaFactorId = data.id;
      const qrEl = document.getElementById('mfa-qr-wrap');
      if (qrEl && data.totp?.qr_code) {
        qrEl.innerHTML = `<img src="${data.totp.qr_code}" alt="QR Code" style="width:180px;height:180px">`;
      }
      const secretEl = document.getElementById('mfa-secret-text');
      if (secretEl && data.totp?.secret) {
        secretEl.textContent = `Or enter this key manually: ${data.totp.secret}`;
      }
    } catch (err) {
      console.error('MFA enroll error:', err);
      const errEl = document.getElementById('mfa-enroll-error');
      if (errEl) errEl.textContent = err.message;
    }

    document.getElementById('mfa-verify-enroll-btn')?.addEventListener('click', async () => {
      const code = document.getElementById('mfa-verify-code')?.value;
      const errEl = document.getElementById('mfa-enroll-error');
      if (!code || code.length !== 6) {
        if (errEl) errEl.textContent = 'Enter the 6-digit code from your app.';
        return;
      }
      try {
        const { data: challenge } = await auth.mfa.challenge({ factorId: mfaFactorId });
        if (challenge) mfaChallengeId = challenge.id;
        const { error } = await auth.mfa.verify({ factorId: mfaFactorId, challengeId: mfaChallengeId, code });
        if (error) throw error;
        // Show recovery codes
        const recDiv = document.getElementById('mfa-recovery');
        const recCodes = document.getElementById('mfa-recovery-codes');
        if (recDiv) recDiv.style.display = 'block';
        if (recCodes) {
          recCodes.innerHTML = (data.totp?.recovery_codes || []).map(c => `<code>${c}</code>`).join('');
        }
        if (errEl) errEl.textContent = '';
        document.getElementById('mfa-verify-code').value = '';
      } catch (err) {
        if (errEl) errEl.textContent = err.message;
      }
    });

    document.getElementById('mfa-recovery-done')?.addEventListener('click', () => {
      const mfaScreen = document.getElementById('mfa-screen');
      if (mfaScreen) mfaScreen.classList.remove('active');
      showDashboard();
    });
  }

  function showMFAChallenge() {
    const mfaScreen = document.getElementById('mfa-screen');
    const enrollDiv = document.getElementById('mfa-enroll');
    const challengeDiv = document.getElementById('mfa-challenge');
    if (!mfaScreen) return;
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    mfaScreen.classList.add('active');
    if (enrollDiv) enrollDiv.style.display = 'none';
    if (challengeDiv) challengeDiv.style.display = 'block';

    document.getElementById('mfa-verify-challenge-btn')?.addEventListener('click', async () => {
      const code = document.getElementById('mfa-challenge-code')?.value;
      const errEl = document.getElementById('mfa-challenge-error');
      if (!code || code.length !== 6) {
        if (errEl) errEl.textContent = 'Enter the 6-digit code.';
        return;
      }
      try {
        const { data: challenge } = await auth.mfa.challenge({ factorId: mfaFactorId });
        const { error } = await auth.mfa.verify({ factorId: mfaFactorId, challengeId: challenge.id, code });
        if (error) throw error;
        if (errEl) errEl.textContent = '';
        document.getElementById('mfa-challenge-code').value = '';
        const mfaScreen = document.getElementById('mfa-screen');
        if (mfaScreen) mfaScreen.classList.remove('active');
        authAttempts = 0;
        // Re-check session state — Supabase should now have the full session
        const { data: { session } } = await auth.getSession();
        if (session?.user) {
          auth.emit('authStateChange', 'SIGNED_IN', session);
        }
      } catch (err) {
        if (errEl) errEl.textContent = err.message;
      }
    });
  }

  async function checkEmailAndMFA(sbUser) {
    // Check email verification
    try {
      const { data: { user } } = await auth.getUser();
      if (user && !user.email_confirmed_at && !user.phone) {
        const verifyScreen = document.getElementById('verify-email-screen');
        const addrEl = document.getElementById('verify-email-addr');
        if (addrEl && user.email) addrEl.textContent = user.email;
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        if (verifyScreen) verifyScreen.classList.add('active');
        tabBar.style.display = 'none';
        fab.style.display = 'none';
        return false;
      }
    } catch {}
    return true;
  }

  function showDashboard() {
    const user = currentUser;
    if (!user) return;
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const activeEl = document.getElementById(state.activeScreen);
    if (activeEl) activeEl.classList.add('active');
    tabBar.style.display = 'grid';
    fab.style.display = 'block';
    updateUserUI(user);
    registerNativePush(user);
  }

  // Welcome carousel
  let welcomeStep = 0;
  const WELCOME_TEXTS = ["That's what I need", "Sounds about right", "Show Me the Truth", "I'm in", "Let's Go"];
  const welcomeCta = document.getElementById('welcome-cta');
  const welcomeSlider = document.getElementById('welcome-slider');
  const welcomeSlides = document.querySelectorAll('.welcome-slide');
  const welcomeDots = document.querySelectorAll('#welcome-dots .dot');

  function updateScene(step) {
    document.querySelectorAll('.scene').forEach(s => {
      s.classList.toggle('active', parseInt(s.dataset.scene) === step);
    });
  }

  function advanceWelcomeStep() {
    const nextStep = welcomeStep + 1;
    if (nextStep >= WELCOME_TEXTS.length) {
      window._welcomeSeen = '1';
      localStorage.setItem('welcomeSeen', '1');
      if (window.Capacitor?.Plugins?.Preferences) {
        window.Capacitor.Plugins.Preferences.set({ key: 'welcomeSeen', value: '1' });
      }
      document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
      authScreen.classList.add('active');
      state.activeScreen = 'auth-screen';
      return;
    }

    haptic('light');
    welcomeStep = nextStep;

    // Slide text
    welcomeSlides.forEach(s => {
      s.style.transform = `translateX(-${nextStep * 100}%)`;
    });

    // Update dots
    welcomeDots.forEach(d => d.classList.toggle('active', parseInt(d.dataset.index) === welcomeStep));

    // Update button text
    welcomeCta.textContent = WELCOME_TEXTS[welcomeStep];

    // Toggle scene
    updateScene(welcomeStep);
  }

  welcomeCta.addEventListener('click', advanceWelcomeStep);

  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      haptic('light');
      await auth.signOut();
    });
  }

  function updateUserUI(user) {
    const displayName = user.displayName || 'User';
    const h2 = new Date().getHours(); const timeGreet = h2 < 12 ? 'Good morning' : h2 < 18 ? 'Good afternoon' : 'Good evening';
    if (greetingText) greetingText.textContent = `${timeGreet}, ${displayName.split(' ')[0]}.`;
    if (avatarEl) avatarEl.textContent = displayName.substring(0, 2).toUpperCase();
    if (profileNameInput) profileNameInput.value = displayName;
    if (profileEmailInput) profileEmailInput.value = user.email;
  }

  // Supabase handles OAuth redirect automatically via onAuthStateChange

  let sbUnsubTransactions = null;
  let sbUnsubPrefs = null;

  function attachDataListeners(user) {
    if (sbUnsubTransactions) { sbUnsubTransactions(); sbUnsubTransactions = null; }
    if (sbUnsubPrefs) { sbUnsubPrefs(); sbUnsubPrefs = null; }

    isFirestoreReady = false;

    // Initial load from Supabase
    sb.loadTransactions(user.uid)
      .then(txData => {
        transactions.length = 0;
        txData.forEach(t => {
          t.group = computeDateGroup(t.date);
          transactions.push(t);
        });

        // Load preferences
        return sb.loadPreferences(user.uid);
      })
      .then(prefData => {
        if (prefData) applyPrefsToState(prefData);
      })
      .catch(() => {})
      .finally(() => {
        isFirestoreReady = true;
        if (transactions.length === 0) {
          checkOnboarding(user);
        } else {
          fullRender();
        }
      });

    // Subscribe to real-time changes
    sbUnsubTransactions = sb.subscribeTransactions(user.uid,
      () => {},
      (action, data) => {
        if (action === 'inserted') {
          data.group = computeDateGroup(data.date);
          transactions.unshift(data);
        } else if (action === 'updated') {
          const idx = transactions.findIndex(t => t.id === data.id);
          if (idx >= 0) { data.group = computeDateGroup(data.date); transactions[idx] = data; }
        } else if (action === 'deleted') {
          transactions = transactions.filter(t => t.id !== data);
        }
        fullRender();
      }
    );

    sbUnsubPrefs = sb.subscribePreferences(user.uid, (prefData) => {
      applyPrefsToState(prefData);
    });
  }

  function applyPrefsToState(data) {
    if (data.currency && currencySymbols[data.currency]) state.currency = data.currency;
    if (typeof data.darkMode === 'boolean') state.darkMode = data.darkMode;
    if (typeof data.notifications === 'boolean') state.notifications = data.notifications;
    if (typeof data.bankSync === 'boolean') state.bankSync = data.bankSync;
    if (data.budgetTargets) Object.assign(state.budgetTargets, data.budgetTargets);
    if (typeof data.budgetTolerance === 'number') state.budgetTolerance = data.budgetTolerance;
    if (typeof data.defaultPaymentSource === 'string') state.defaultPaymentSource = data.defaultPaymentSource;
    if (typeof data.defaultBudgetCategory === 'string') state.defaultBudgetCategory = data.defaultBudgetCategory;
    if (typeof data.monthlyIncome === 'number') state.monthlyIncome = data.monthlyIncome;
    if (typeof data.filterMaxAmount === 'number') state.filterMaxAmount = data.filterMaxAmount;
    if (typeof data.holdHintShown === 'boolean') state.holdHintShown = data.holdHintShown;
    saveStorage();
    applyTheme();
    if (isFirestoreReady) {
      renderGoalsCard();
      fullRender();
    }
  }

  function checkOnboarding(user) {
    sb.loadOnboarding(user.uid)
      .then(data => {
        if (data && data.completed) {
          if (data.income) state.monthlyIncome = data.income;
          if (data.goals) state.goals = data.goals;
          if (data.quiz_correct) localStorage.setItem('onboardingQuizScore', String(data.quiz_correct));
          renderGoalsCard();
          saveStorage();
          fullRender();
        } else {
          showOnboarding(user);
        }
      })
      .catch(() => showOnboarding(user));
  }

  auth.onAuthStateChange(async (event, session) => {
    console.log('Auth event:', event, session ? `user=${session.user.id}` : 'no session');
    const sbUser = session?.user ?? null;
    const user = sbUser ? {
      uid: sbUser.id,
      email: sbUser.email,
      displayName: sbUser.user_metadata?.full_name || sbUser.email?.split('@')[0] || 'User',
    } : null;
    currentUser = user;

    if (user) {
      ensureUserProfile(user);

      // Check email verification
      const emailOk = await checkEmailAndMFA(sbUser);
      if (!emailOk) return;

      // Check MFA enrollment
      try {
        const { data: factors } = await auth.mfa.list();
        if (factors?.all?.length === 0) {
          // No MFA enrolled — require enrollment
          await showMFAEnrollment();
          return;
        }
      } catch {} // MFA not supported or error — skip

      isFirestoreReady = false;
      attachDataListeners(user);
      authScreen.classList.remove('active');
      if (state.activeScreen === 'auth-screen' || !state.activeScreen) {
        state.activeScreen = 'dashboard-screen';
      }
      showDashboard();
    } else {
      if (sbUnsubTransactions) { sbUnsubTransactions(); sbUnsubTransactions = null; }
      if (sbUnsubPrefs) { sbUnsubPrefs(); sbUnsubPrefs = null; }
      isFirestoreReady = false;
      document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
      if (window._welcomeSeen) {
        authScreen.classList.add('active');
        state.activeScreen = 'auth-screen';
      } else {
        document.getElementById('welcome-screen').classList.add('active');
        state.activeScreen = 'welcome-screen';
        updateScene(0);
      }
      tabBar.style.display = 'none';
      fab.style.display = 'none';
      authEmail.value = '';
      authPassword.value = '';
      authName.value = '';
      authSubmitBtn.disabled = false;
      authSubmitBtn.textContent = 'Login';
    }
  });

  // Verify email buttons
  document.getElementById('verify-resend-btn')?.addEventListener('click', async () => {
    const user = currentUser;
    if (!user?.email) return;
    try {
      await auth.resend({ type: 'signup', email: user.email });
      showToast('Confirmation email sent!');
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    }
  });

  document.getElementById('verify-refresh-btn')?.addEventListener('click', async () => {
    const { data: { user } } = await auth.getUser();
    if (user?.email_confirmed_at) {
      // Email confirmed — proceed to MFA check
      const { data: factors } = await auth.mfa.list().catch(() => ({ data: null }));
      if (factors?.all?.length === 0) {
        await showMFAEnrollment();
      } else {
        showDashboard();
      }
    } else {
      showToast('Email not yet confirmed. Check your inbox.', 'error');
    }
  });

  // Initialize non-auth-dependent UI after merge
  initGreeting();
  initTabs();
  initSettings();
  initFab();
  initSheets();
  initSearch();
  initFilters();
  initAnalyticsControls();
  initNotificationCenter();
  renderAddCategoryChips();
  setTimeout(() => {
    document.querySelectorAll('.animate-in').forEach(el => el.classList.remove('animate-in'));
  }, state.reducedMotion ? 0 : 260);
});

function updateMetricsFromTransactions() {
  const today = new Date();
  const currentMonthKey = today.toISOString().slice(0, 7);
  const nonExcludedTx = transactions.filter(t => !t.isExcluded);
  const availableMonths = [...new Set(nonExcludedTx.map(t => t.date.slice(0, 7)))].sort();
  const activeMonthKey = availableMonths.includes(currentMonthKey)
    ? currentMonthKey
    : (availableMonths[availableMonths.length - 1] || currentMonthKey);
  const currentMonthTx = nonExcludedTx.filter(t => t.date.slice(0, 7) === activeMonthKey);
  const categoryTotals = {};
  let totalSpent = 0;
  const budgetTotals = { Needs: 0, Wants: 0, Investments: 0 };
  
  currentMonthTx.forEach(t => {
    if (t.type === 'Expense') {
      const amt = Math.abs(t.amount);
      categoryTotals[t.category] = (categoryTotals[t.category] || 0) + amt;
      totalSpent += amt;
      if (budgetTotals[t.budgetCategory] !== undefined) budgetTotals[t.budgetCategory] += amt;
    }
  });

  budgetData.segments[0].spent = budgetTotals.Needs;
  budgetData.segments[1].spent = budgetTotals.Wants;
  budgetData.segments[2].spent = budgetTotals.Investments;
  
  const totalBudgetSpent = budgetTotals.Needs + budgetTotals.Wants + budgetTotals.Investments || 1;
  budgetData.segments[0].percentage = Math.round((budgetTotals.Needs / totalBudgetSpent) * 100) || 0;
  budgetData.segments[1].percentage = Math.round((budgetTotals.Wants / totalBudgetSpent) * 100) || 0;
  budgetData.segments[2].percentage = Math.round((budgetTotals.Investments / totalBudgetSpent) * 100) || 0;

  categoryBreakdown = Object.keys(categoryTotals).map(cat => ({
    category: cat,
    amount: categoryTotals[cat],
    percent: Math.round((categoryTotals[cat] / (totalSpent || 1)) * 100),
    color: cat === 'Food' || cat === 'Health' || cat === 'Utilities' || cat === 'Transport' ? 'var(--color-accent-needs)' : 
           cat === 'Shopping' || cat === 'Entertainment' || cat === 'Dining' || cat === 'Travel' ? 'var(--color-accent-wants)' : 'var(--color-accent-savings)'
  })).sort((a, b) => b.amount - a.amount);
  
  if (categoryBreakdown.length === 0) categoryBreakdown = [{ category: 'Other', amount: 0, percent: 0, color: 'var(--color-accent-savings)' }];
  
  let totalIncome = 0;
  currentMonthTx.forEach(t => {
    if (t.type === 'Income') {
      totalIncome += Math.abs(t.amount);
    }
  });

  const effectiveIncome = state.monthlyIncome > 0 ? state.monthlyIncome : totalIncome;
  if (effectiveIncome > 0) budgetData.totalBudget = effectiveIncome;
  else budgetData.totalBudget = 0;
  budgetData.remaining = budgetData.totalBudget - totalSpent;

  const heroAmount = document.querySelector('.hero-amount');
  if (heroAmount) {
    heroAmount.textContent = fmtShort(budgetData.remaining);
  }
  const budgetCaption = document.getElementById('budget-caption');
  if (budgetCaption) {
    budgetCaption.textContent = `of ${fmtShort(budgetData.totalBudget)} budget`;
  }

  const analyticsIncome = document.getElementById('analytics-income');
  const analyticsExpenses = document.getElementById('analytics-expenses');
  const analyticsNet = document.getElementById('analytics-net');
  if (analyticsIncome) analyticsIncome.textContent = `+${fmtShort(effectiveIncome)}`;
  if (analyticsExpenses) analyticsExpenses.textContent = `−${fmtShort(totalSpent)}`;
  if (analyticsNet) analyticsNet.textContent = `Net Savings: ${fmtShort(effectiveIncome - totalSpent)}`;

  const monthStats = {};
  nonExcludedTx.forEach(t => {
    const monthKey = t.date.slice(0, 7);
    if (!monthStats[monthKey]) monthStats[monthKey] = { income: 0, spent: 0 };
    if (t.type === 'Income') monthStats[monthKey].income += Math.abs(t.amount);
    if (t.type === 'Expense') monthStats[monthKey].spent += Math.abs(t.amount);
  });

  if (state.monthlyIncome > 0) {
    const curKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    if (monthStats[curKey]) {
      monthStats[curKey].income = Math.max(monthStats[curKey].income, state.monthlyIncome);
    } else {
      monthStats[curKey] = { income: state.monthlyIncome, spent: 0 };
    }
  }

  const monthEntries = Object.entries(monthStats);
  const monthCount = monthEntries.length || 1;
  const totalMonthlySpent = monthEntries.reduce((sum, [, values]) => sum + values.spent, 0);
  const totalMonthlyIncome = monthEntries.reduce((sum, [, values]) => sum + values.income, 0);
  const totalMonthlyNet = monthEntries.reduce((sum, [, values]) => sum + (values.income - values.spent), 0);

  const avgSpent = totalMonthlySpent / monthCount;
  const avgIncome = totalMonthlyIncome / monthCount;
  const avgNet = totalMonthlyNet / monthCount;
  const avgNetSign = avgNet >= 0 ? '+' : '−';
  const avgCaption = `${monthEntries.length} month avg`;

  const homeAvgSpendingEl = document.getElementById('home-avg-spending');
  if (homeAvgSpendingEl) {
    homeAvgSpendingEl.textContent = fmt(avgSpent);
  }

  const homeAvgNetEl = document.getElementById('home-avg-net');
  if (homeAvgNetEl) {
    homeAvgNetEl.textContent = avgNetSign + fmt(Math.abs(avgNet));
  }

  const homeAvgSpendingCaptionEl = document.getElementById('home-avg-spending-caption');
  const homeAvgNetCaptionEl = document.getElementById('home-avg-net-caption');
  if (homeAvgSpendingCaptionEl) homeAvgSpendingCaptionEl.textContent = avgCaption;
  if (homeAvgNetCaptionEl) homeAvgNetCaptionEl.textContent = avgCaption;

  // Update Cash Flow Ratio Bar (SVG)
  const totalFlow = effectiveIncome + totalSpent || 1;
  const inflowPercent = (effectiveIncome / totalFlow) * 100;
  
  const cashflowSvg = document.getElementById('hero-cashflow-svg');
  if (cashflowSvg) {
    cashflowSvg.style.height = '8px';
    cashflowSvg.setAttribute('viewBox', '0 0 100 8');
    cashflowSvg.setAttribute('preserveAspectRatio', 'none');
    cashflowSvg.innerHTML = `
      <line x1="0" y1="4" x2="${inflowPercent}" y2="4" stroke="var(--color-income-green)" stroke-width="8" />
      <line x1="${inflowPercent}" y1="4" x2="100" y2="4" stroke="var(--color-expense-red)" stroke-width="8" />
    `;
  }

  const inflowLabel = document.getElementById('hero-inflow-label');
  const outflowLabel = document.getElementById('hero-outflow-label');
  if (inflowLabel) inflowLabel.textContent = '+' + fmt(effectiveIncome);
  if (outflowLabel) outflowLabel.textContent = '−' + fmt(totalSpent);

  // Update Daily Allowance (Wants only)
  const todayTx = transactions.filter(t => !t.isExcluded && t.group === 'Today');
  let todaySpent = 0;
  todayTx.forEach(t => {
    if (t.type === 'Expense' && t.budgetCategory === 'Wants') {
      todaySpent += Math.abs(t.amount);
    }
  });

  const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const remainingDays = Math.max(1, lastDay - today.getDate());
  const wantsBudget = budgetData.totalBudget * (state.budgetTargets.wants / 100);
  const wantsRemaining = Math.max(0, wantsBudget - budgetTotals.Wants);
  const dailyAllowance = remainingDays > 0 ? wantsRemaining / remainingDays : 0;

  const remainingAllowance = Math.max(0, dailyAllowance - todaySpent);
  const allowancePercent = Math.min(100, dailyAllowance > 0 ? (remainingAllowance / dailyAllowance) * 100 : 0);

  const allowanceCaption = document.getElementById('hero-allowance-caption');
  if (allowanceCaption) {
    allowanceCaption.textContent = `${fmt(remainingAllowance)} remaining of ${fmt(dailyAllowance)}/day`;
  }

  const allowanceSvg = document.getElementById('hero-allowance-svg');
  if (allowanceSvg) {
    allowanceSvg.setAttribute('viewBox', '0 0 100 8');
    allowanceSvg.setAttribute('preserveAspectRatio', 'none');
    allowanceSvg.innerHTML = `
      <line x1="0" y1="4" x2="100" y2="4" stroke="var(--color-divider)" stroke-width="8" stroke-linecap="round" />
      <line x1="0" y1="4" x2="${allowancePercent}" y2="4" stroke="var(--color-accent-needs)" stroke-width="8" stroke-linecap="round" />
    `;
  }
  // --- Compute trendMonthlyData (last 6 months) ---
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    months.push(key);
  }
  trendMonthlyData.length = 0;
  months.forEach(m => {
    const monthTx = nonExcludedTx.filter(t => t.date.slice(0, 7) === m && t.type === 'Expense');
    const needs = monthTx.filter(t => t.budgetCategory === 'Needs').reduce((s, t) => s + Math.abs(t.amount), 0);
    const wants = monthTx.filter(t => t.budgetCategory === 'Wants').reduce((s, t) => s + Math.abs(t.amount), 0);
    const investments = monthTx.filter(t => t.budgetCategory === 'Investments').reduce((s, t) => s + Math.abs(t.amount), 0);
    trendMonthlyData.push({ month: m, needs, wants, investments });
  });

  // --- Compute cashFlowData (last 6 months) ---
  cashFlowData.length = 0;
  months.forEach(m => {
    const monthTx = nonExcludedTx.filter(t => t.date.slice(0, 7) === m);
    const txIncome = monthTx.filter(t => t.type === 'Income').reduce((s, t) => s + Math.abs(t.amount), 0);
    const income = txIncome > 0 ? txIncome : (m === months[months.length - 1] ? state.monthlyIncome : 0);
    const expenses = monthTx.filter(t => t.type === 'Expense').reduce((s, t) => s + Math.abs(t.amount), 0);
    const maxVal = Math.max(income, expenses, 1);
    cashFlowData.push({ month: m, income: (income / maxVal) * 100, expenses: (expenses / maxVal) * 100 });
  });

  renderBudgetRule();
  renderHomeBudgetRule();
}

function loadStorage() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.dismissedAlerts)) state.dismissedAlerts = new Set(parsed.dismissedAlerts);
    if (Array.isArray(parsed.excludedTransactions)) state.excludedTransactions = new Set(parsed.excludedTransactions);
    if (Array.isArray(parsed.recurringTransactions)) state.recurringTransactions = new Set(parsed.recurringTransactions);
    if (typeof parsed.darkMode === 'boolean') state.darkMode = parsed.darkMode;
    if (typeof parsed.currency === 'string') state.currency = parsed.currency;
    if (typeof parsed.notifications === 'boolean') state.notifications = parsed.notifications;
    if (typeof parsed.bankSync === 'boolean') state.bankSync = parsed.bankSync;
    if (parsed.budgetTargets) { Object.assign(state.budgetTargets, parsed.budgetTargets); }
    if (typeof parsed.budgetTolerance === 'number') state.budgetTolerance = parsed.budgetTolerance;
    if (typeof parsed.defaultPaymentSource === 'string') state.defaultPaymentSource = parsed.defaultPaymentSource;
    if (typeof parsed.defaultBudgetCategory === 'string') state.defaultBudgetCategory = parsed.defaultBudgetCategory;
    if (typeof parsed.monthlyIncome === 'number') state.monthlyIncome = parsed.monthlyIncome;
    if (Array.isArray(parsed.goals)) state.goals = parsed.goals;
    if (typeof parsed.filterMaxAmount === 'number') state.filterMaxAmount = parsed.filterMaxAmount;
    if (typeof parsed.holdHintShown === 'boolean') state.holdHintShown = parsed.holdHintShown;
    if (Array.isArray(parsed.transactions)) {
      parsed.transactions.forEach(t => {
        t.isExcluded = state.excludedTransactions.has(t.id);
        t.isRecurring = state.recurringTransactions.has(t.id) || t.isRecurring;
        if (t.isRecurring && !t.recurringInterval) t.recurringInterval = 'monthly';
        if (!t.group) t.group = computeDateGroup(t.date);
        transactions.push(t);
      });
    }
  } catch (error) {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function saveStorage() {
  const storedTransactions = transactions.filter(t => t.id.startsWith('t') || t.id.startsWith('opt-'));
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      dismissedAlerts: [...state.dismissedAlerts],
      excludedTransactions: [...state.excludedTransactions],
      recurringTransactions: [...state.recurringTransactions],
      darkMode: state.darkMode,
      currency: state.currency,
      notifications: state.notifications,
      bankSync: state.bankSync,
      budgetTargets: { ...state.budgetTargets },
      budgetTolerance: state.budgetTolerance,
      defaultPaymentSource: state.defaultPaymentSource,
      defaultBudgetCategory: state.defaultBudgetCategory,
      monthlyIncome: state.monthlyIncome,
      goals: state.goals,
      filterMaxAmount: state.filterMaxAmount,
      holdHintShown: state.holdHintShown,
      transactions: storedTransactions
    })
  );
}

function applyTheme() {
  const app = document.querySelector('.app');
  if (!app) return;
  app.classList.toggle('dark-mode', state.darkMode);
}

function initSettings() {
  const currencyEl = document.getElementById('setting-currency');
  const darkModeToggle = document.getElementById('setting-dark-mode');
  const notifToggle = document.getElementById('setting-notifications');
  const bankSyncToggle = document.getElementById('setting-bank-sync');
  const exportBtn = document.getElementById('export-data-btn');
  const profileNameInput = document.getElementById('profile-name-input');
  const profileEmailInput = document.getElementById('profile-email-input');
  const needsInput = document.getElementById('setting-target-needs');
  const wantsInput = document.getElementById('setting-target-wants');
  const investmentsInput = document.getElementById('setting-target-investments');
  const toleranceInput = document.getElementById('setting-tolerance');
  const budgetTotalTracker = document.getElementById('budget-total-tracker');
  const saveChangesBtn = document.getElementById('save-changes-btn');
  const changePasswordBtn = document.getElementById('change-password-btn');
  const defaultAccountEl = document.getElementById('setting-default-account');
  const defaultBudgetEl = document.getElementById('setting-default-budget');

  // ---- Currency ----
  if (currencyEl) {
    currencyEl.value = state.currency;
    currencyEl.addEventListener('change', () => {
      state.currency = currencyEl.value;
      saveStorage();
      syncSettingsToFirestore();
      fullRender();
    });
  }

  // ---- Dark Mode ----
  if (darkModeToggle) {
    const cb = darkModeToggle.querySelector('input');
    if (cb) cb.checked = state.darkMode;
    darkModeToggle.classList.toggle('active', state.darkMode);
    darkModeToggle.addEventListener('click', (e) => {
      e.preventDefault();
      haptic('light');
      state.darkMode = !state.darkMode;
      if (cb) cb.checked = state.darkMode;
      darkModeToggle.classList.toggle('active', state.darkMode);
      applyTheme();
      saveStorage();
      syncSettingsToFirestore();
    });
  }

  // ---- Notifications ----
  if (notifToggle) {
    const cb = notifToggle.querySelector('input');
    if (cb) cb.checked = state.notifications;
    notifToggle.classList.toggle('active', state.notifications);
    notifToggle.addEventListener('click', (e) => {
      e.preventDefault();
      haptic('light');
      state.notifications = !state.notifications;
      if (cb) cb.checked = state.notifications;
      notifToggle.classList.toggle('active', state.notifications);
      if (!state.notifications) {
        state.dismissedAlerts.clear();
        alerts.forEach(a => state.dismissedAlerts.add(a.id));
      }
      saveStorage();
      syncSettingsToFirestore();
      renderAlerts();
    });
  }

  // ---- Bank Sync ----
  if (bankSyncToggle) {
    const cb = bankSyncToggle.querySelector('input');
    if (cb) cb.checked = state.bankSync;
    bankSyncToggle.classList.toggle('active', state.bankSync);
    bankSyncToggle.addEventListener('click', (e) => {
      e.preventDefault();
      haptic('light');
      state.bankSync = !state.bankSync;
      if (cb) cb.checked = state.bankSync;
      bankSyncToggle.classList.toggle('active', state.bankSync);
      saveStorage();
      syncSettingsToFirestore();
    });
  }

  // ---- Data Export ----
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      const data = {
        exportedAt: new Date().toISOString(),
        transactions,
        budgetData,
        state: {
          currency: state.currency,
          darkMode: state.darkMode,
          notifications: state.notifications,
          bankSync: state.bankSync
        }
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `clearr-budget-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      exportBtn.textContent = 'Exported!';
      setTimeout(() => { exportBtn.textContent = 'Export'; }, 2000);
    });
  }

  // ---- Budget Targets ----
  function updateBudgetTotalTracker() {
    if (!budgetTotalTracker || !needsInput || !wantsInput || !investmentsInput) return;
    const n = parseFloat(needsInput.value) || 0;
    const w = parseFloat(wantsInput.value) || 0;
    const s = parseFloat(investmentsInput.value) || 0;
    const total = n + w + s;
    const isValid = total === 100;

    if (n + w > 100) {
      budgetTotalTracker.textContent = `Needs (${n}%) + Wants (${w}%) exceeds 100%`;
      budgetTotalTracker.className = 'budget-total-tracker invalid';
      return;
    }

    budgetTotalTracker.textContent = `Total: ${n}% + ${w}% + ${s}% = ${total}% ${isValid ? '✓' : '✗'}`;
    budgetTotalTracker.className = 'budget-total-tracker' + (isValid ? '' : ' invalid');
  }

  function updateInvestmentsReadonly() {
    if (!needsInput || !wantsInput || !investmentsInput) return;
    const n = parseFloat(needsInput.value) || 0;
    const w = parseFloat(wantsInput.value) || 0;
    const remaining = Math.max(0, 100 - n - w);
    investmentsInput.value = remaining;
    updateBudgetTotalTracker();
  }

  if (needsInput) {
    needsInput.value = state.budgetTargets.needs;
    needsInput.addEventListener('input', updateInvestmentsReadonly);
  }
  if (wantsInput) {
    wantsInput.value = state.budgetTargets.wants;
    wantsInput.addEventListener('input', updateInvestmentsReadonly);
  }
  if (investmentsInput) {
    investmentsInput.value = state.budgetTargets.investments;
  }

  // Initial tracker render
  updateInvestmentsReadonly();

  // ---- Tolerance ----
  if (toleranceInput) {
    toleranceInput.value = state.budgetTolerance;
  }

  // ---- Default Payment Source ----
  if (defaultAccountEl) {
    defaultAccountEl.value = state.defaultPaymentSource;
    defaultAccountEl.addEventListener('change', () => {
      state.defaultPaymentSource = defaultAccountEl.value;
      saveStorage();
      syncSettingsToFirestore();
    });
  }

  // ---- Default Budget Category ----
  if (defaultBudgetEl) {
    defaultBudgetEl.value = state.defaultBudgetCategory;
    defaultBudgetEl.addEventListener('change', () => {
      state.defaultBudgetCategory = defaultBudgetEl.value;
      saveStorage();
      syncSettingsToFirestore();
    });
  }

  // ---- Profile fields ----
  if (profileNameInput) {
    profileNameInput.value = currentUser?.displayName || '';
  }
  if (profileEmailInput) {
    profileEmailInput.value = currentUser?.email || '';
  }

  // ---- Sticky Save Changes ----
  if (saveChangesBtn) {
    saveChangesBtn.addEventListener('click', () => {
      // Save budget targets
      if (needsInput && wantsInput) {
        const n = parseFloat(needsInput.value) || 0;
        const w = parseFloat(wantsInput.value) || 0;
        state.budgetTargets.needs = n;
        state.budgetTargets.wants = w;
        state.budgetTargets.investments = Math.max(0, 100 - n - w);
      }

      // Save tolerance
      if (toleranceInput) {
        state.budgetTolerance = Math.max(1, Math.min(20, parseFloat(toleranceInput.value) || 3));
        toleranceInput.value = state.budgetTolerance;
      }

      // Save profile name
      if (profileNameInput && currentUser) {
        const user = currentUser;
        const newName = profileNameInput.value;
        if (newName !== (user.displayName || '')) {
          sb.updateProfileName(user.uid, newName).catch(() => {});
          updateUserUI(user);
        }
      }

      saveStorage();
      syncSettingsToFirestore();
      fullRender();

      saveChangesBtn.textContent = 'Saved!';
      setTimeout(() => { saveChangesBtn.textContent = 'Save Changes'; }, 2000);
    });
  }

  // ---- Change Password ----
  if (changePasswordBtn) {
    changePasswordBtn.addEventListener('click', () => {
      const form = document.getElementById('password-change-form');
      if (form) {
        const isVisible = form.style.display !== 'none';
        form.style.display = isVisible ? 'none' : 'block';
        if (!isVisible) {
          ['pw-current', 'pw-new', 'pw-confirm'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
          });
          const errEl = document.getElementById('pw-change-error');
          if (errEl) errEl.textContent = '';
        }
      }
    });
  }

  document.getElementById('pw-change-submit')?.addEventListener('click', async () => {
    const currentPw = document.getElementById('pw-current')?.value;
    const newPw = document.getElementById('pw-new')?.value;
    const confirmPw = document.getElementById('pw-confirm')?.value;
    const errEl = document.getElementById('pw-change-error');

    if (!currentPw || !newPw || !confirmPw) {
      if (errEl) errEl.textContent = 'Fill in all fields.';
      return;
    }
    if (newPw !== confirmPw) {
      if (errEl) errEl.textContent = 'New passwords do not match.';
      return;
    }
    const pwErrors = validatePassword(newPw);
    if (pwErrors.length > 0) {
      if (errEl) errEl.textContent = '• ' + pwErrors.join('\n• ');
      return;
    }

    try {
      // Verify current password by attempting sign-in
      const user = currentUser;
      if (!user?.email) {
        if (errEl) errEl.textContent = 'No email on file.';
        return;
      }
      const { error: signInErr } = await auth.signInWithPassword({ email: user.email, password: currentPw });
      if (signInErr) throw new Error('Current password is incorrect.');

      const { error } = await auth.updateUser({ password: newPw });
      if (error) throw error;

      const form = document.getElementById('password-change-form');
      if (form) form.style.display = 'none';
      if (errEl) errEl.textContent = '';
      showToast('Password updated successfully!');
    } catch (err) {
      if (errEl) errEl.textContent = err.message;
    }
  });
}

function renderGoalsCard() {
  const card = document.getElementById('goals-card');
  if (!card) return;
  const hasGoals = state.goals.length > 0 || state.monthlyIncome > 0;
  card.style.display = hasGoals ? 'block' : 'none';
  const listEl = document.getElementById('goals-list');
  if (listEl) listEl.textContent = state.goals.length > 0 ? state.goals.map(g => g.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())).join(', ') : '—';
  const incomeEl = document.getElementById('goals-income');
  if (incomeEl) incomeEl.textContent = state.monthlyIncome > 0 ? fmtShort(state.monthlyIncome) : '—';
  const quizEl = document.getElementById('goals-quiz');
  if (quizEl) quizEl.textContent = localStorage.getItem('onboardingQuizScore') ? localStorage.getItem('onboardingQuizScore') + '/4' : '—';
}

function initGreeting() {
  const h = new Date().getHours();
  const greet = h < 12 ? 'Good morning, David.' : h < 18 ? 'Good afternoon, David.' : 'Good evening, David.';
  const el = document.getElementById('greeting-text');
  if (el) el.textContent = greet;
}

function initTabs() {
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      haptic('light');
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.screen;
      if (!target) return;
      document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
      const screen = document.getElementById(target);
      if (screen) screen.classList.add('active');
      state.activeScreen = target;
    });
  });
}

function initFab() {
  const fab = document.getElementById('fab');
  const radial = document.getElementById('fab-radial');
  const fabOverlay = document.getElementById('fab-overlay');
  if (!fab || !radial) return;

  const showMenu = () => {
    radial.classList.add('open');
    if (fabOverlay) fabOverlay.classList.add('show');
  };

  const hideMenu = () => {
    radial.classList.remove('open');
    if (fabOverlay) fabOverlay.classList.remove('show');
  };

  let pressTimer = null;

  const onPressStart = () => {
    fab.classList.add('pressed');
    pressTimer = setTimeout(showMenu, 480);
  };

  const onPressEnd = () => {
    fab.classList.remove('pressed');
    if (pressTimer) clearTimeout(pressTimer);
  };

  fab.addEventListener('mousedown', onPressStart);
  fab.addEventListener('mouseup', onPressEnd);
  fab.addEventListener('mouseleave', onPressEnd);
  fab.addEventListener('touchstart', onPressStart, { passive: true });
  fab.addEventListener('touchend', onPressEnd);

  fab.addEventListener('click', () => {
    if (radial.classList.contains('open')) return;
    haptic('medium');
    state.editTransactionId = null;
    openSheet('add-sheet');
  });

  if (fabOverlay) {
    fabOverlay.addEventListener('click', hideMenu);
  }

  radial.querySelector('[data-action="ai-insight"]')?.addEventListener('click', () => {
    haptic('light');
    hideMenu();
    showAIInsight();
  });

  radial.querySelector('[data-action="bank-sync"]')?.addEventListener('click', () => {
    haptic('light');
    hideMenu();
    showComingSoon('Auto Bank Sync', 'Bank sync integration is coming soon. You can manually add transactions in the meantime.');
  });

  // Close menu only when clicking outside fab AND outside the radial
  document.addEventListener('click', (e) => {
    if (!radial.classList.contains('open')) return;
    if (fab.contains(e.target)) return;
    if (radial.contains(e.target)) return;
    hideMenu();
  });

  // Teaching hint: show once on first load
  const hint = document.getElementById('fab-hint');
  if (hint && !state.holdHintShown) {
    const dismissHint = () => {
      hint.classList.remove('show');
      setTimeout(() => { hint.style.display = 'none'; }, 150);
    };

    const showHint = () => {
      if (fab.style.display === 'none') { setTimeout(showHint, 500); return; }
      state.holdHintShown = true;
      saveStorage();
      hint.style.display = '';
      hint.classList.remove('animate-in');
      setTimeout(() => hint.classList.add('show'), 50);
    };
    setTimeout(showHint, 800);

    hint.addEventListener('click', dismissHint);

    // Dismiss hint the first time the menu opens
    const menuObserver = new MutationObserver(() => {
      if (radial.classList.contains('open')) {
        dismissHint();
        menuObserver.disconnect();
      }
    });
    menuObserver.observe(radial, { attributes: true, attributeFilter: ['class'] });
  }
}

function initSheets() {
  const closeAdd = document.getElementById('close-add');
  const overlay = document.getElementById('overlay');
  const closeFilter = document.getElementById('close-filter');
  const openFilter = document.getElementById('open-filter');
  const closeDetail = document.getElementById('close-detail');
  if (overlay) overlay.addEventListener('click', closeAllSheets);
  if (closeAdd) closeAdd.addEventListener('click', closeAllSheets);
  if (closeFilter) closeFilter.addEventListener('click', closeAllSheets);
  if (closeDetail) closeDetail.addEventListener('click', closeAllSheets);
  if (openFilter) openFilter.addEventListener('click', () => { haptic('light'); openSheet('filter-sheet'); });
  document.getElementById('close-category-picker')?.addEventListener('click', closeCategoryPicker);

  const saveBtn = document.getElementById('save-transaction');
  if (saveBtn) saveBtn.addEventListener('click', () => { haptic('medium'); saveTransaction(); });

  const txTypeSeg = document.getElementById('tx-type-segment');
  if (txTypeSeg) {
    txTypeSeg.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        haptic('light');
        txTypeSeg.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.txType = btn.dataset.type;
      });
    });
  }
}

function openSheet(id) {
  const overlay = document.getElementById('overlay');
  if (overlay) overlay.classList.add('show');
  const saveError = document.getElementById('save-error');
  if (saveError) saveError.textContent = '';
  ['add-sheet', 'detail-sheet', 'filter-sheet'].forEach(sid => {
    const el = document.getElementById(sid);
    if (!el) return;
    if (sid === id) el.classList.add('show');
    else el.classList.remove('show');
  });
}

function updateTxTypeUI() {
  const seg = document.getElementById('tx-type-segment');
  if (!seg) return;
  seg.querySelectorAll('button').forEach(b => b.classList.remove('active'));
  const activeBtn = seg.querySelector(`[data-type="${state.txType}"]`);
  if (activeBtn) activeBtn.classList.add('active');
}

function closeAllSheets() {
  const overlay = document.getElementById('overlay');
  if (overlay) overlay.classList.remove('show');
  ['add-sheet', 'detail-sheet', 'filter-sheet', 'notification-center'].forEach(sid => {
    const el = document.getElementById(sid);
    if (el) el.classList.remove('show');
  });
}

function showComingSoon(title, body) {
  const overlay = document.getElementById('coming-soon-overlay');
  const titleEl = document.getElementById('coming-soon-title');
  const bodyEl = document.getElementById('coming-soon-body');
  if (!overlay || !titleEl || !bodyEl) return;
  titleEl.textContent = title;
  bodyEl.textContent = body;
  overlay.style.display = 'flex';
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('.coming-soon-card') === null) {
      overlay.style.display = 'none';
    }
  });
  document.getElementById('coming-soon-close')?.addEventListener('click', () => {
    haptic('light');
    overlay.style.display = 'none';
  });
}

function showAIInsight() {
  const screen = document.getElementById('ai-insight-screen');
  if (!screen) return;
  screen.classList.add('show');

  const closeBtn = document.getElementById('close-ai-insight');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      haptic('light');
      screen.classList.remove('show');
    });
  }

  const currentMonthTx = transactions.filter(t => !t.isExcluded && t.date.slice(0, 7) === new Date().toISOString().slice(0, 7));
  let totalIncome = 0;
  let totalSpent = 0;
  const budgetTotals = { Needs: 0, Wants: 0, Investments: 0 };

  currentMonthTx.forEach(t => {
    const amt = Math.abs(t.amount);
    if (t.type === 'Income') totalIncome += amt;
    else if (t.type === 'Expense') {
      totalSpent += amt;
      if (budgetTotals[t.budgetCategory] !== undefined) budgetTotals[t.budgetCategory] += amt;
    }
  });
  const netSaved = totalIncome - totalSpent;

  // Financial Health Score (0-100)
  const totalSpentSafe = budgetTotals.Needs + budgetTotals.Wants + budgetTotals.Investments || 1;
  const actualPct = {
    Needs: (budgetTotals.Needs / totalSpentSafe) * 100,
    Wants: (budgetTotals.Wants / totalSpentSafe) * 100,
    Investments: (budgetTotals.Investments / totalSpentSafe) * 100
  };
  const targetPct = {
    Needs: state.budgetTargets.needs,
    Wants: state.budgetTargets.wants,
    Investments: state.budgetTargets.investments
  };

  let totalDeviation = 0;
  let categoryScores = [];
  ['Needs', 'Wants', 'Investments'].forEach(key => {
    const diff = Math.abs(actualPct[key] - targetPct[key]);
    const score = Math.max(0, 100 - diff * 2);
    totalDeviation += diff;
    categoryScores.push({ name: key, actual: actualPct[key], target: targetPct[key], score, color: key === 'Needs' ? 'var(--color-accent-needs)' : key === 'Wants' ? 'var(--color-accent-wants)' : 'var(--color-accent-savings)' });
  });

  const avgScore = Math.round(Math.max(0, 100 - totalDeviation / 3 * 2));

  // Score color
  const scoreColor = avgScore >= 80 ? 'var(--color-income-green)' : avgScore >= 50 ? 'var(--color-accent-wants)' : 'var(--color-expense-red)';

  // Animate score ring
  const arc = document.getElementById('ai-score-arc');
  const numEl = document.getElementById('ai-score-number');
  if (arc) {
    const circumference = 326.73;
    const offset = circumference - (avgScore / 100) * circumference;
    arc.style.stroke = scoreColor;
    arc.style.transition = 'stroke-dashoffset 1s ease-out';
    arc.style.strokeDashoffset = offset;
  }
  if (numEl) {
    numEl.style.color = scoreColor;
    numEl.textContent = avgScore;
  }

  // Generate insights
  const list = document.getElementById('ai-insights-list');
  if (!list) return;
  const insights = [];

  // Budget adherence insight
  categoryScores.forEach(cat => {
    const status = cat.score >= 80 ? 'On track' : cat.score >= 50 ? 'Slight deviation' : 'Off track';
    const icon = cat.score >= 80 ? 'ph-check-circle' : cat.score >= 50 ? 'ph-warning-circle' : 'ph-x-circle';
    const statusColor = cat.score >= 80 ? 'var(--color-income-green)' : cat.score >= 50 ? 'var(--color-accent-wants)' : 'var(--color-expense-red)';
    insights.push(`
      <div class="ai-insight-item animate-in" style="--delay:${categoryScores.indexOf(cat) * 60}ms">
        <div class="ai-insight-header">
          <i class="ph ${icon}" style="color:${statusColor}"></i>
          <strong>${cat.name}</strong>
          <span class="ai-badge" style="background:${statusColor}">${status}</span>
        </div>
        <p>Target: ${Math.round(cat.target)}% · Actual: ${Math.round(cat.actual)}%</p>
      </div>
    `);
  });

  // Savings rate insight
  if (totalIncome > 0) {
    const savingsRate = Math.round(((totalIncome - totalSpent) / totalIncome) * 100);
    const savingsStatus = savingsRate >= 20 ? 'Excellent' : savingsRate >= 10 ? 'Good' : savingsRate >= 0 ? 'Needs improvement' : 'Overspent';
    const savingsColor = savingsRate >= 20 ? 'var(--color-income-green)' : savingsRate >= 10 ? 'var(--color-accent-wants)' : 'var(--color-expense-red)';
    insights.push(`
      <div class="ai-insight-item animate-in" style="--delay:180ms">
        <div class="ai-insight-header">
          <i class="ph ph-trend-up" style="color:${savingsColor}"></i>
          <strong>Savings Rate</strong>
          <span class="ai-badge" style="background:${savingsColor}">${savingsStatus}</span>
        </div>
        <p>${netSaved >= 0 ? `You're saving ${savingsRate}% of income (${fmt(netSaved)}) this month.` : `You're ${Math.abs(savingsRate)}% overspent (${fmt(Math.abs(netSaved))}) this month.`} ${savingsRate >= 20 ? 'Great job building your nest egg!' : savingsRate >= 10 ? 'Solid progress — try to reach 20%.' : savingsRate >= 0 ? 'Look for small cuts to boost savings.' : 'Consider reviewing your expenses.'}</p>
      </div>
    `);
  }

  // Top spending category insight
  if (categoryBreakdown.length > 0 && categoryBreakdown[0].amount > 0) {
    const top = categoryBreakdown[0];
    insights.push(`
      <div class="ai-insight-item animate-in" style="--delay:240ms">
        <div class="ai-insight-header">
          <i class="ph ph-lightbulb" style="color:var(--color-accent-wants)"></i>
          <strong>Top Category</strong>
        </div>
        <p>Your biggest expense this month is <strong>${top.category}</strong> at ${fmt(top.amount)} (${top.percent}% of spending).</p>
      </div>
    `);
  }

  // Largest single expense
  const expenseTx = currentMonthTx.filter(t => t.type === 'Expense');
  if (expenseTx.length > 0) {
    const maxTx = expenseTx.reduce((a, b) => Math.abs(a.amount) > Math.abs(b.amount) ? a : b);
    insights.push(`
      <div class="ai-insight-item animate-in" style="--delay:300ms">
        <div class="ai-insight-header">
          <i class="ph ph-warning-circle" style="color:var(--color-expense-red)"></i>
          <strong>Largest Expense</strong>
        </div>
        <p>"${maxTx.name}" (${maxTx.category}) — ${fmt(Math.abs(maxTx.amount))} on ${maxTx.date}.</p>
      </div>
    `);
  }

  list.innerHTML = insights.join('');

  setTimeout(() => {
    list.querySelectorAll('.animate-in').forEach(el => el.classList.remove('animate-in'));
  }, 600);
}

function renderLegend() {
  const legend = document.getElementById('legend-row');
  if (!legend) return;
  legend.innerHTML = budgetData.segments.map(item => `
    <div class="legend-item">
      <div class="legend-top"><span class="legend-box" style="background:${item.color}"></span><span class="label">${item.name}</span></div>
      <span class="legend-amount">${fmt(item.spent)}</span>
    </div>
  `).join('');
}

function polar(cx, cy, r, a) {
  const rad = (a * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx, cy, r, start, end) {
  const p1 = polar(cx, cy, r, start);
  const p2 = polar(cx, cy, r, end);
  const span = Math.abs(end - start);
  const large = span > 180 ? 1 : 0;
  return `M ${p1.x.toFixed(3)} ${p1.y.toFixed(3)} A ${r} ${r} 0 ${large} 1 ${p2.x.toFixed(3)} ${p2.y.toFixed(3)}`;
}

function renderHalfDonut() {
  const svg = document.getElementById('half-donut');
  if (!svg) return;
  const cx = 150;
  const cy = 172;
  const r = 120;
  const stroke = 32;
  const totalBudget = budgetData.totalBudget || 1;
  const gap = 0;
  let cursor = 180;
  const baseTrack = `<path d="${arcPath(cx, cy, r, 180, 360)}" stroke="var(--color-divider)" fill="none" stroke-width="${stroke}" stroke-linecap="butt" />`;
  const parts = [baseTrack];
  budgetData.segments.forEach((segment, index) => {
    const degrees = Math.max(0, (segment.spent / totalBudget) * 180);
    if (degrees <= 0) return;
    const start = cursor + gap;
    const end = cursor + degrees - gap;
    if (end <= start) {
      cursor += degrees;
      return;
    }
    const path = arcPath(cx, cy, r, start, end);
    parts.push(`<path d="${path}" stroke="${segment.color}" fill="none" stroke-width="${stroke}" stroke-linecap="butt" class="seg" data-index="${index}" />`);
    cursor += degrees;
  });
  svg.innerHTML = parts.join('');
  const label = 'Budget distribution chart';
  svg.setAttribute('aria-label', label);
  animateDonutSegments();
}

function animateDonutSegments() {
  const segs = Array.from(document.querySelectorAll('#half-donut .seg'));
  if (state.reducedMotion) return;
  segs.forEach((seg, i) => {
    const len = seg.getTotalLength();
    seg.style.strokeDasharray = `${len}`;
    seg.style.strokeDashoffset = `${len}`;
    seg.style.transition = `stroke-dashoffset 500ms ease-out ${i * 80}ms`;
    requestAnimationFrame(() => {
      seg.style.strokeDashoffset = '0';
    });
  });
}

function renderCashFlow() {
  const svg = document.getElementById('cashflow-svg');
  if (!svg) return;
  if (cashFlowData.length === 0) {
    svg.innerHTML = '';
    return;
  }
  const w = 330;
  const h = 180;
  const left = 28;
  const right = 12;
  const top = 10;
  const bottom = 24;
  const chartW = w - left - right;
  const chartH = h - top - bottom;

  const y = value => top + chartH - (value / 100) * chartH;
  const x = index => left + (index / (cashFlowData.length - 1)) * chartW;

  const grid = [0, 25, 50, 75, 100].map(v => `<line x1="${left}" y1="${y(v)}" x2="${w - right}" y2="${y(v)}" stroke="var(--color-divider)" stroke-width="1"/>`).join('');
  const labelsY = [0, 25, 50, 75, 100].map(v => `<text x="2" y="${y(v) + 4}" font-size="11" fill="var(--color-text-secondary)">${v}</text>`).join('');

  const incomePath = cashFlowData.map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(d.income)}`).join(' ');
  const expensePath = cashFlowData.map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(d.expenses)}`).join(' ');

  const xLabels = cashFlowData.map((d, i) => `<text x="${x(i)}" y="${h - 4}" text-anchor="middle" font-size="11" fill="var(--color-text-secondary)">${d.month}</text>`).join('');
  const incomePoints = cashFlowData.map((d, i) => `<circle class="cash-point" data-index="${i}" data-kind="cash" cx="${x(i)}" cy="${y(d.income)}" r="6" fill="var(--color-income-green)"/>`).join('');
  const expensePoints = cashFlowData.map((d, i) => `<circle class="cash-point" data-index="${i}" data-kind="cash" cx="${x(i)}" cy="${y(d.expenses)}" r="6" fill="var(--color-expense-red)"/>`).join('');

  svg.innerHTML = `${grid}${labelsY}${xLabels}<path d="${incomePath}" fill="none" stroke="var(--color-income-green)" stroke-width="2.5"/><path d="${expensePath}" fill="none" stroke="var(--color-expense-red)" stroke-width="2.5"/>${incomePoints}${expensePoints}`;

  svg.querySelectorAll('.cash-point').forEach(point => {
    point.addEventListener('click', () => {
      const i = Number(point.dataset.index);
      const d = cashFlowData[i];
      const tooltip = document.getElementById('cashflow-tooltip');
      if (tooltip) tooltip.textContent = `${d.month}: Income ${d.income}% · Expenses ${d.expenses}%`;
    });
  });
}

const severityIcons = { critical: 'ph-warning-circle', crucial: 'ph-warning', info: 'ph-info' };

function cleanupSwipeListeners() {
  document.querySelectorAll('.alert-card').forEach(card => {
    if (card._swipeCleanup) {
      card._swipeCleanup(card);
      delete card._swipeCleanup;
    }
  });
}

function renderAlerts() {
  const stack = document.getElementById('alerts-stack');
  if (!stack) return;
  cleanupSwipeListeners();
  const activeAlerts = alerts.filter(a => !state.dismissedAlerts.has(a.id));
  if (activeAlerts.length === 0) { stack.innerHTML = '<div class="empty-state" style="margin-top:var(--space-xl)"><p style="color:var(--color-text-secondary)">No alerts</p></div>'; updateAlertBadge(); return; }
  stack.innerHTML = activeAlerts.map(a => `
    <article class="alert-card" data-id="${a.id}">
      <span class="alert-accent ${a.type}"></span>
      <i class="ph ${severityIcons[a.type] || 'ph-info'} alert-icon ${a.type}"></i>
      <div class="alert-body">
        <h4>${a.title}</h4>
        <p>${a.body}</p>
      </div>
      <button class="alert-close" aria-label="Dismiss alert"><i class="ph ph-x"></i></button>
    </article>
  `).join('');

  stack.querySelectorAll('.alert-close').forEach(btn => {
    btn.addEventListener('click', e => {
      const card = e.currentTarget.closest('.alert-card');
      if (!card) return;
      dismissAlert(card.dataset.id);
    });
  });

  stack.querySelectorAll('.alert-card').forEach(card => {
    addSwipeDismiss(card, () => dismissAlert(card.dataset.id));
  });
  updateAlertBadge();
}

function dismissAlert(id) {
  if (!id) return;
  state.dismissedAlerts.add(id);
  saveStorage();
  renderAlerts();
  const panel = document.getElementById('notification-center');
  if (panel && panel.classList.contains('show')) renderNotificationCenter();
}

function addSwipeDismiss(element, onDismiss) {
  let startX = 0;
  let deltaX = 0;
  let dragging = false;
  const width = () => element.getBoundingClientRect().width;

  const down = e => {
    dragging = true;
    startX = e.touches ? e.touches[0].clientX : e.clientX;
    element.style.transition = 'none';
  };

  const move = e => {
    if (!dragging) return;
    const x = e.touches ? e.touches[0].clientX : e.clientX;
    deltaX = Math.min(0, x - startX);
    element.style.transform = `translateX(${deltaX}px)`;
  };

  const up = () => {
    if (!dragging) return;
    dragging = false;
    const ratio = Math.abs(deltaX) / width();
    element.style.transition = state.reducedMotion ? 'none' : 'transform 200ms ease-in';
    if (ratio >= 0.4) {
      element.style.transform = `translateX(-${width() + 40}px)`;
      setTimeout(() => {
        cleanupSwipe(element);
        onDismiss();
      }, state.reducedMotion ? 0 : 200);
    } else {
      element.style.transform = 'translateX(0)';
    }
  };

  function cleanupSwipe(el) {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    el.removeEventListener('mousedown', down);
    el.removeEventListener('touchstart', down);
    el.removeEventListener('touchmove', move);
    el.removeEventListener('touchend', up);
  }

  element._swipeCleanup = cleanupSwipe;

  element.addEventListener('mousedown', down);
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
  element.addEventListener('touchstart', down, { passive: true });
  element.addEventListener('touchmove', move, { passive: true });
  element.addEventListener('touchend', up);
}

function showToast(message, type) {
  const existing = document.querySelector('.toast-notification');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'toast-notification';
  toast.style.cssText = `
    position: absolute; bottom: calc(80px + env(safe-area-inset-bottom)); left: 50%; transform: translateX(-50%);
    background: var(--color-text-primary); color: var(--color-background); padding: 12px 20px; border-radius: 14px;
    font-size: 13px; font-weight: 500; z-index: 50; white-space: nowrap; max-width: 90vw;
    box-shadow: var(--shadow-fab);
  `;
  toast.textContent = message;
  document.getElementById('app').appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function updateAlertBadge() {
  const badge = document.getElementById('alerts-badge');
  if (!badge) return;
  if (!state.notifications) { badge.style.display = 'none'; return; }
  const unread = alerts.filter(a => !state.dismissedAlerts.has(a.id)).length;
  badge.style.display = unread > 0 ? 'block' : 'none';
}

function renderNotificationCenter() {
  const list = document.getElementById('notifications-list');
  if (!list) return;
  const activeAlerts = alerts.filter(a => !state.dismissedAlerts.has(a.id));

  if (activeAlerts.length === 0) {
    list.innerHTML = `<div class="empty-state"><i class="ph ph-bell-slash" style="font-size:48px;color:var(--color-text-disabled)"></i><p style="color:var(--color-text-secondary);margin-top:12px">No notifications</p></div>`;
    return;
  }

  const severityOrder = { critical: 0, crucial: 1, info: 2 };
  const sorted = [...activeAlerts].sort((a, b) => severityOrder[a.type] - severityOrder[b.type]);

  list.innerHTML = sorted.map(a => `
    <article class="alert-card" data-id="${a.id}">
      <span class="alert-accent ${a.type}"></span>
      <i class="ph ${severityIcons[a.type] || 'ph-info'} alert-icon ${a.type}"></i>
      <div class="alert-body">
        <h4>${a.title}</h4>
        <p>${a.body}</p>
      </div>
      <button class="alert-close" aria-label="Dismiss"><i class="ph ph-x"></i></button>
    </article>
  `).join('');

  list.querySelectorAll('.alert-close').forEach(btn => {
    btn.addEventListener('click', e => {
      const card = e.currentTarget.closest('.alert-card');
      if (!card) return;
      dismissAlert(card.dataset.id);
    });
  });
}

function initNotificationCenter() {
  const bell = document.getElementById('bell-btn');
  const close = document.getElementById('close-notification-center');
  const clearAll = document.getElementById('clear-all-notifications');
  const panel = document.getElementById('notification-center');

  if (bell) {
    bell.addEventListener('click', () => {
      if (!panel) return;
      panel.classList.add('show');
      renderNotificationCenter();
    });
  }

  if (close) {
    close.addEventListener('click', () => {
      if (panel) panel.classList.remove('show');
    });
  }

  if (clearAll) {
    clearAll.addEventListener('click', () => {
      alerts.forEach(a => state.dismissedAlerts.add(a.id));
      saveStorage();
      renderNotificationCenter();
      renderAlerts();
    });
  }
}

function initSearch() {
  const input = document.getElementById('search-input');
  const clear = document.getElementById('clear-search');
  const wrap = document.getElementById('search-wrap');
  if (!input || !clear || !wrap) return;
  input.addEventListener('input', () => {
    wrap.classList.toggle('has-text', Boolean(input.value.trim()));
    renderTransactions();
  });
  clear.addEventListener('click', () => {
    input.value = '';
    wrap.classList.remove('has-text');
    renderTransactions();
  });
}

function initFilters() {
  const maxAmount = document.getElementById('max-amount');
  const maxAmountLabel = document.getElementById('max-amount-label');
  const apply = document.getElementById('apply-filters');
  const clear = document.getElementById('clear-filters');
  const dateFilter = document.getElementById('date-filter');
  const chipsWrap = document.getElementById('filter-categories');

  if (chipsWrap) {
    chipsWrap.innerHTML = filtersMetaCategories.map(c => `<button class="chip ${c === 'All' ? 'selected' : ''}" data-category="${c}">${c}</button>`).join('');
    chipsWrap.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const cat = chip.dataset.category;
        if (!cat) return;
        if (cat === 'All') {
          state.filters.categories = new Set(['All']);
        } else {
          state.filters.categories.delete('All');
          if (state.filters.categories.has(cat)) state.filters.categories.delete(cat);
          else state.filters.categories.add(cat);
          if (state.filters.categories.size === 0) state.filters.categories.add('All');
        }
        chipsWrap.querySelectorAll('.chip').forEach(c => c.classList.toggle('selected', state.filters.categories.has(c.dataset.category)));
      });
    });
  }

  if (maxAmount && maxAmountLabel) {
    maxAmount.max = String(state.filterMaxAmount);
    maxAmount.value = String(state.filters.maxAmount);
    maxAmountLabel.textContent = fmtShort(state.filters.maxAmount || state.filterMaxAmount);
    maxAmount.addEventListener('input', () => {
      state.filters.maxAmount = Number(maxAmount.value);
      maxAmountLabel.textContent = fmtShort(state.filters.maxAmount);
    });
  }

  if (dateFilter) {
    dateFilter.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        haptic('light');
        dateFilter.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.filters.date = btn.dataset.date || 'This Month';
      });
    });
  }

  if (apply) apply.addEventListener('click', () => {
    haptic('medium');
    closeAllSheets();
    renderTransactions();
  });

  if (clear) clear.addEventListener('click', () => {
    haptic('light');
    state.filters.maxAmount = 0;
    state.filters.categories = new Set(['All']);
    state.filters.date = 'This Month';
    if (maxAmount) maxAmount.value = String(state.filterMaxAmount);
    if (maxAmountLabel) maxAmountLabel.textContent = fmtShort(state.filterMaxAmount);
    if (dateFilter) dateFilter.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.date === 'This Month'));
    if (chipsWrap) chipsWrap.querySelectorAll('.chip').forEach(c => c.classList.toggle('selected', c.dataset.category === 'All'));
    renderTransactions();
  });
}

function getFilteredTransactions() {
  const input = document.getElementById('search-input');
  const query = (input ? input.value : '').trim().toLowerCase();
  const now = new Date();
  let list = [...transactions];
  list = list.filter(tx => {
    const amount = Math.abs(tx.amount);
    if (state.filters.maxAmount > 0 && amount > state.filters.maxAmount) return false;
    if (!state.filters.categories.has('All') && !state.filters.categories.has(tx.category)) return false;
    const d = new Date(`${tx.date}T12:00:00`);
    if (state.filters.date === 'Today' && tx.group !== 'Today') return false;
    if (state.filters.date === 'This Week') {
      const diff = Math.floor((now - d) / (1000 * 60 * 60 * 24));
      if (diff > 7) return false;
    }
    if (state.filters.date === 'This Month') {
      if (d.getMonth() !== now.getMonth() || d.getFullYear() !== now.getFullYear()) return false;
    }
    if (!query) return true;
    const combined = `${tx.name} ${tx.category} ${tx.merchant}`.toLowerCase();
    return combined.includes(query);
  });
  return list;
}

function renderTransactions(customList) {
  const listEl = document.getElementById('transactions-list');
  if (!listEl) return;
  const list = customList || getFilteredTransactions();
  if (list.length === 0) {
    listEl.innerHTML = '<div class="empty-state"><i class="ph ph-receipt" style="font-size:32px;color:var(--color-text-disabled)"></i><p style="color:var(--color-text-secondary);margin-top:8px">No transactions yet</p></div>';
    return;
  }
  const grouped = list.reduce((acc, tx) => {
    if (!acc[tx.group]) acc[tx.group] = [];
    acc[tx.group].push(tx);
    return acc;
  }, {});

  const groupOrder = ['Today', 'Yesterday'];
  const groups = Object.keys(grouped).sort((a, b) => {
    const ia = groupOrder.indexOf(a);
    const ib = groupOrder.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return b.localeCompare(a);
  });
  listEl.innerHTML = groups.map(group => {
    const cards = grouped[group].map(tx => {
      const sign = tx.amount >= 0 ? '+' : '−';
      const amountClass = tx.amount >= 0 ? 'income-text' : 'expense-text';
      const recurringIcon = tx.isRecurring ? ' <i class="ph ph-arrows-clockwise" style="font-size:12px;color:var(--color-accent-needs)"></i>' : '';
      return `
        <article class="tx-card" data-id="${tx.id}">
          <div class="tx-icon"><i class="ph ${iconForCategory(tx.category)}"></i></div>
          <div class="tx-main">
            <strong>${tx.name}${recurringIcon}</strong>
            <small>${tx.merchant} · ${tx.category}</small>
          </div>
          <div class="tx-amount">
            <b class="${amountClass}">${sign}${fmt(Math.abs(tx.amount))}</b>
            <small>${tx.time}</small>
          </div>
        </article>
      `;
    }).join('');
    return `<h3 class="date-header">${group}</h3>${cards}`;
  }).join('');

  listEl.querySelectorAll('.tx-card').forEach(card => {
    card.addEventListener('click', () => openTransactionDetail(card.dataset.id));
  });
}

function iconForCategory(category) {
  const map = {
    Food: 'ph-fork-knife',
    Groceries: 'ph-basket',
    Dining: 'ph-hamburger',
    Coffee: 'ph-coffee',
    Bakery: 'ph-cake',
    Delivery: 'ph-scooter',
    Transport: 'ph-car',
    Fuel: 'ph-gas-pump',
    Parking: 'ph-traffic-cone',
    'Public Transit': 'ph-bus',
    'Ride Share': 'ph-taxi',
    Shopping: 'ph-bag',
    Clothing: 'ph-t-shirt',
    Electronics: 'ph-devices',
    'Home Goods': 'ph-couch',
    Beauty: 'ph-sparkle',
    Gifts: 'ph-gift',
    Pets: 'ph-paw-print',
    Entertainment: 'ph-television',
    Streaming: 'ph-video',
    Gaming: 'ph-game-controller',
    Movies: 'ph-film-strip',
    Music: 'ph-music-note',
    Books: 'ph-book',
    Sports: 'ph-barbell',
    Travel: 'ph-airplane',
    Hotels: 'ph-buildings',
    Flights: 'ph-airplane-tilt',
    Utilities: 'ph-lightning',
    Phone: 'ph-phone',
    Internet: 'ph-wifi-high',
    Insurance: 'ph-shield-check',
    Subscriptions: 'ph-currency-circle-dollar',
    Rent: 'ph-house',
    Health: 'ph-heartbeat',
    Pharmacy: 'ph-first-aid',
    Gym: 'ph-barbell',
    Doctor: 'ph-stethoscope',
    Dental: 'ph-tooth',
    Wellness: 'ph-flower-lotus',
    Education: 'ph-graduation-cap',
    Childcare: 'ph-baby',
    Other: 'ph-dots-three-circle'
  };
  return map[category] || 'ph-receipt';
}

function openTransactionDetail(id) {
  const tx = transactions.find(t => t.id === id);
  if (!tx) return;
  state.selectedTransactionId = id;
  const detail = document.getElementById('detail-content');
  if (!detail) return;
  const sign = tx.amount >= 0 ? '+' : '−';
  const amountClass = tx.amount >= 0 ? 'income-text' : 'expense-text';

  detail.innerHTML = `
    <div class="title-row"><div class="tx-icon" style="width:48px;height:48px"><i class="ph ${iconForCategory(tx.category)}" style="font-size:20px"></i></div><div style="flex:1;margin-left:12px"><h2>${tx.name}</h2></div><h1 class="hero-amount ${amountClass}" style="font-size:36px">${sign}${fmt(Math.abs(tx.amount))}</h1></div>
    <div class="summary-card" style="padding:12px;margin-top:12px">
      <div class="setting-item"><span>Date & Time</span><strong>${new Date(tx.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · ${tx.time}</strong></div>
      <div class="setting-item"><span>Category</span><strong>${tx.budgetCategory} → ${tx.category}</strong></div>
      <div class="setting-item"><span>Payment Source</span><strong>${tx.paymentSource}</strong></div>
      <div class="setting-item"><span>Status</span><strong><i class="ph ph-check-circle" style="color:var(--color-income-green)"></i> Settled</strong></div>
    </div>
    <div id="receipt-area">${tx.receiptUrl
      ? `<div class="summary-card" style="margin-top:12px;overflow:hidden;border-radius:12px;position:relative"><img src="${tx.receiptUrl}" style="width:100%;display:block" crossorigin="anonymous"><button id="remove-receipt" class="icon-btn" style="position:absolute;top:8px;right:8px;background:rgba(0,0,0,0.5);color:#fff;border:0;border-radius:50%;width:28px;height:28px;cursor:pointer"><i class="ph ph-x"></i></button></div>`
      : `<button class="summary-card" id="attach-receipt" style="margin-top:12px;border:1.5px dashed var(--color-divider);height:120px;width:100%;display:grid;place-items:center;background:var(--color-background)"><div style="text-align:center;color:var(--color-text-disabled)"><i class="ph ph-receipt" style="font-size:32px"></i><div>Tap to scan or attach receipt</div></div></button>`}
    <label class="input-label">Notes & Tags</label>
    <textarea id="detail-notes" style="width:100%;min-height:72px;border:0;border-radius:12px;background:var(--color-surface);padding:8px 12px">${tx.notes || ''}</textarea>
    <div class="metrics-row" style="margin-top:12px">
      <button class="metric-card" id="split-btn" style="text-align:center"><i class="ph ph-divide" style="font-size:20px"></i><div class="label">Split</div></button>
      <button class="metric-card" id="exclude-btn" style="text-align:center"><i class="ph ph-eye-closed" style="font-size:20px"></i><div class="label">${tx.isExcluded ? 'Excluded' : 'Exclude'}</div></button>
      ${tx.isRecurring
        ? `<button class="metric-card" id="recurring-btn" style="text-align:center;flex-shrink:0"><i class="ph ph-arrows-clockwise" style="font-size:20px"></i><div class="label">Recurring · ${tx.recurringInterval || 'monthly'}</div></button><button class="metric-card" id="recurring-off-btn" style="text-align:center;flex-shrink:0;color:var(--color-expense-red)"><i class="ph ph-x" style="font-size:20px"></i></button>`
        : `<button class="metric-card" id="recurring-btn" style="text-align:center"><i class="ph ph-arrows-clockwise" style="font-size:20px"></i><div class="label">Make Recurring</div></button>`
      }
    </div>
    <button class="primary-btn" id="edit-transaction">Edit Transaction</button>
    <button class="text-btn" id="delete-transaction" style="color:var(--color-expense-red)">Delete</button>
  `;

  const user = currentUser;

  detail.querySelector('#exclude-btn')?.addEventListener('click', () => {
    haptic('light');
    tx.isExcluded = !tx.isExcluded;
    if (tx.isExcluded) state.excludedTransactions.add(tx.id);
    else state.excludedTransactions.delete(tx.id);
    saveStorage();
    if (user) {
      sb.updateTransaction(tx.id, user.uid, { isExcluded: tx.isExcluded }).catch(err => { console.error('Update failed:', err); showToast('Failed to sync.', 'error'); });
    }
    openTransactionDetail(tx.id);
    fullRender();
  });

  detail.querySelector('#recurring-btn')?.addEventListener('click', () => {
    haptic('light');
    if (tx.isRecurring) {
      tx.isRecurring = false;
      tx.recurringInterval = null;
      state.recurringTransactions.delete(tx.id);
      saveStorage();
      if (user) {
        sb.updateTransaction(tx.id, user.uid, { isRecurring: false, recurringInterval: null }).catch(err => { console.error('Update failed:', err); showToast('Failed to sync.', 'error'); });
      }
      openTransactionDetail(tx.id);
      fullRender();
    } else {
      const btn = detail.querySelector('#recurring-btn');
      btn.innerHTML = `<div style="display:flex;gap:6px;width:100%;justify-content:center">
        <span class="freq-opt" data-interval="weekly" style="padding:6px 8px;border-radius:8px;background:var(--color-surface-elevated);font-size:12px;font-weight:500;cursor:pointer">Weekly</span>
        <span class="freq-opt" data-interval="monthly" style="padding:6px 8px;border-radius:8px;background:var(--color-accent-needs);color:#fff;font-size:12px;font-weight:500;cursor:pointer">Monthly</span>
        <span class="freq-opt" data-interval="yearly" style="padding:6px 8px;border-radius:8px;background:var(--color-surface-elevated);font-size:12px;font-weight:500;cursor:pointer">Yearly</span>
      </div>`;
      btn.querySelectorAll('.freq-opt').forEach(el => {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          tx.isRecurring = true;
          tx.recurringInterval = el.dataset.interval;
          state.recurringTransactions.add(tx.id);
          saveStorage();
          if (user) {
            sb.updateTransaction(tx.id, user.uid, { isRecurring: true, recurringInterval: tx.recurringInterval }).catch(err => { console.error('Update failed:', err); showToast('Failed to sync.', 'error'); });
          }
          openTransactionDetail(tx.id);
          fullRender();
        });
      });
    }
  });

  detail.querySelector('#recurring-off-btn')?.addEventListener('click', () => {
    haptic('medium');
    tx.isRecurring = false;
    tx.recurringInterval = null;
    state.recurringTransactions.delete(tx.id);
    saveStorage();
    if (user) {
      sb.updateTransaction(tx.id, user.uid, { isRecurring: false, recurringInterval: null }).catch(err => { console.error('Update failed:', err); showToast('Failed to sync.', 'error'); });
    }
    openTransactionDetail(tx.id);
    fullRender();
  });

  detail.querySelector('#delete-transaction')?.addEventListener('click', () => {
    haptic('heavy');
    const idx = transactions.findIndex(t => t.id === tx.id);
    if (idx >= 0) transactions.splice(idx, 1);
    if (!user) saveStorage();
    if (user && !tx.id.startsWith('t') && !tx.id.startsWith('opt-')) {
      sb.deleteTransaction(tx.id, user.uid).catch(err => { console.error('Delete failed:', err); showToast('Failed to delete.', 'error'); });
    }
    closeAllSheets();
    fullRender();
  });

  detail.querySelector('#split-btn')?.addEventListener('click', () => {
    alert('Split transaction feature coming soon.');
  });

  detail.querySelector('#edit-transaction')?.addEventListener('click', () => {
    haptic('medium');
    state.editTransactionId = tx.id;
    state.txType = tx.type || 'Expense';
    state.selectedCategory = tx.category || 'Food';
    updateTxTypeUI();
    renderAddCategoryChips();
    closeAllSheets();
    openSheet('add-sheet');
    document.getElementById('tx-name').value = tx.name || '';
    document.getElementById('tx-amount').value = Math.abs(tx.amount);
    document.getElementById('tx-datetime').value = tx.date ? tx.date + 'T' + (tx.time || '12:00') : '';
    const budgetSel = document.getElementById('tx-budget');
    if (budgetSel) budgetSel.value = tx.budgetCategory || 'Needs';
    const acctSel = document.getElementById('tx-account');
    if (acctSel) acctSel.value = tx.paymentSource || 'Revolut';
    document.getElementById('tx-notes').value = tx.notes || '';
  });

  detail.querySelector('#detail-notes')?.addEventListener('input', e => {
    tx.notes = e.target.value;
  });

  detail.querySelector('#attach-receipt')?.addEventListener('click', async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file || !user) return;
      if (file.size > 10 * 1024 * 1024) {
        showToast('Image too large (max 10MB)', 'error');
        return;
      }
      const storagePath = `${user.uid}/receipts/${tx.id}/${file.name}`;
      try {
        showToast('Uploading receipt...', 'info');
        const { error: uploadErr } = await supabase.storage.from('receipts').upload(storagePath, file, { upsert: true });
        if (uploadErr) throw uploadErr;
        const { data: { publicUrl } } = supabase.storage.from('receipts').getPublicUrl(storagePath);
        tx.receiptUrl = publicUrl;
        sb.updateTransaction(tx.id, user.uid, { receiptUrl: publicUrl }).catch(err => console.error('Receipt URL save failed:', err));
        openTransactionDetail(tx.id);
        showToast('Receipt attached.', 'info');
      } catch (err) {
        console.error('Upload failed:', err);
        showToast('Upload failed. Check connection.', 'error');
      }
    };
    input.click();
  });

  detail.querySelector('#remove-receipt')?.addEventListener('click', async () => {
    if (!user) return;
    try {
      if (tx.receiptUrl) {
        const pathMatch = tx.receiptUrl.match(/\/receipts\/(.+)$/);
        if (pathMatch) {
          await supabase.storage.from('receipts').remove([pathMatch[1]]).catch(() => {});
        }
      }
      tx.receiptUrl = null;
      sb.updateTransaction(tx.id, user.uid, { receiptUrl: null }).catch(err => console.error('Receipt remove failed:', err));
      openTransactionDetail(tx.id);
      showToast('Receipt removed.', 'info');
    } catch (err) {
      console.error('Remove failed:', err);
      showToast('Failed to remove receipt.', 'error');
    }
  });

  openSheet('detail-sheet');
}

function renderAddCategoryChips() {
  const chips = document.getElementById('category-chips');
  if (!chips) return;
  const visible = addCategories.slice(0, 8);
  chips.innerHTML = visible.map(cat => `<button class="chip ${cat === state.selectedCategory ? 'selected' : ''}" data-category="${cat}">${cat}</button>`).join('') +
    `<button class="chip" data-category="__picker__">⋮ All</button>`;
  chips.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      haptic('light');
      if (chip.dataset.category === '__picker__') {
        openCategoryPicker();
        return;
      }
      state.selectedCategory = chip.dataset.category || 'Food';
      renderAddCategoryChips();
    });
  });
}

function openCategoryPicker() {
  const panel = document.getElementById('category-picker');
  if (!panel) return;
  panel.classList.add('show');
  const grid = document.getElementById('category-picker-grid');
  if (!grid) return;
  grid.innerHTML = categoryGroups.map(g =>
    `<h4 class="category-group-title">${g.name}</h4>` +
    g.cats.map(cat =>
      `<button class="category-picker-item ${state.selectedCategory === cat ? 'selected' : ''}" data-category="${cat}"><i class="ph ${iconForCategory(cat)}"></i><span>${cat}</span></button>`
    ).join('')
  ).join('');
  grid.querySelectorAll('.category-picker-item').forEach(item => {
    item.addEventListener('click', () => {
      haptic('light');
      state.selectedCategory = item.dataset.category || 'Food';
      closeCategoryPicker();
      renderAddCategoryChips();
    });
  });
}

function closeCategoryPicker() {
  const panel = document.getElementById('category-picker');
  if (!panel) return;
  panel.classList.remove('show');
}

function saveTransaction() {
  const amountEl = document.getElementById('tx-amount');
  const nameEl = document.getElementById('tx-name');
  const dtEl = document.getElementById('tx-datetime');
  const budgetEl = document.getElementById('tx-budget');
  const accountEl = document.getElementById('tx-account');
  const notesEl = document.getElementById('tx-notes');
  const saveError = document.getElementById('save-error');
  const amountRaw = amountEl ? Number(amountEl.value) : 0;
  const name = nameEl ? nameEl.value.trim() : '';
  if (!amountRaw) {
    if (saveError) saveError.textContent = 'Enter an amount.';
    if (amountEl) amountEl.focus();
    return;
  }
  if (!name) {
    if (saveError) saveError.textContent = 'Enter a merchant or description.';
    if (nameEl) nameEl.focus();
    return;
  }
  if (saveError) saveError.textContent = '';
  const isIncome = state.txType === 'Income';
  const signedAmount = isIncome ? Math.abs(amountRaw) : -Math.abs(amountRaw);
  const dt = dtEl && dtEl.value ? new Date(dtEl.value) : new Date();
  const time = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const txData = {
    name,
    merchant: name,
    category: state.selectedCategory,
    budgetCategory: budgetEl ? budgetEl.value : state.defaultBudgetCategory,
    amount: signedAmount,
    type: isIncome ? 'Income' : 'Expense',
    time,
    date: dt.toISOString().slice(0, 10),
    paymentSource: accountEl ? accountEl.value : state.defaultPaymentSource,
    notes: notesEl ? notesEl.value : '',
    tags: []
  };

  const user = currentUser;
  const editing = state.editTransactionId;
  if (!editing) {
    txData.isExcluded = false;
    txData.isRecurring = false;
    txData.recurringInterval = null;
  }
  if (editing) {
    const idx = transactions.findIndex(t => t.id === editing);
    if (idx >= 0) {
      transactions[idx] = { ...transactions[idx], ...txData, group: computeDateGroup(txData.date) };
      if (!user) saveStorage();
    }
    if (user && !editing.startsWith('t') && !editing.startsWith('opt-')) {
      sb.updateTransaction(editing, user.uid, txData).catch(err => { console.error('Update failed:', err); showToast('Failed to save. Check connection.', 'error'); });
    }
    state.editTransactionId = null;
  } else if (user) {
    transactions.unshift({
      id: `opt-${Date.now()}`,
      group: computeDateGroup(txData.date),
      ...txData
    });
    sb.addTransaction(user.uid, txData).then(result => {
      if (result) transactions[0].id = result.id;
    }).catch(err => { console.error('Save failed:', err); showToast('Failed to save. Check connection.', 'error'); });
  } else {
    transactions.unshift({
      id: `t${Date.now()}`,
      group: computeDateGroup(txData.date),
      ...txData
    });
    saveStorage();
  }

  if (amountEl) amountEl.value = '';
  if (nameEl) nameEl.value = '';
  if (dtEl) dtEl.value = '';
  if (notesEl) notesEl.value = '';
  state.txType = 'Expense';
  state.selectedCategory = 'Food';
  renderAddCategoryChips();
  const txTypeSeg = document.getElementById('tx-type-segment');
  if (txTypeSeg) {
    txTypeSeg.querySelectorAll('button').forEach(b => b.classList.remove('active'));
    const expenseBtn = txTypeSeg.querySelector('[data-type="Expense"]');
    if (expenseBtn) expenseBtn.classList.add('active');
  }
  closeAllSheets();
  fullRender();
}

function initAnalyticsControls() {
  const period = document.getElementById('analytics-period');
  const toggle = document.getElementById('trend-toggle');
  if (period) {
    period.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        haptic('light');
        period.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.analyticsPeriod = btn.dataset.period || 'Month';
        renderTrendChart();
      });
    });
  }
  if (toggle) {
    toggle.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        haptic('light');
        toggle.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.trendView = btn.dataset.view || 'line';
        renderTrendChart();
      });
    });
  }
}

function renderTrendChart() {
  const svg = document.getElementById('trend-svg');
  if (!svg) return;
  if (trendMonthlyData.length === 0) { svg.innerHTML = ''; return; }
  const tooltip = document.getElementById('trend-tooltip');
  const w = 330;
  const h = 180;
  const left = 30;
  const right = 10;
  const top = 10;
  const bottom = 24;
  const chartW = w - left - right;
  const chartH = h - top - bottom;
  const y = value => top + chartH - (value / 2500) * chartH;
  const x = i => left + (i / (trendMonthlyData.length - 1)) * chartW;

  const yGrid = [0, 500, 1000, 1500, 2000, 2500].map(v => `<line x1="${left}" y1="${y(v)}" x2="${w - right}" y2="${y(v)}" stroke="var(--color-divider)"/><text x="${left - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--color-text-secondary)">$${v.toLocaleString('en-US')}</text>`).join('');
  const xLabels = trendMonthlyData.map((d, i) => `<text x="${x(i)}" y="${h - 4}" text-anchor="middle" font-size="11" fill="var(--color-text-secondary)">${d.month}</text>`).join('');

  if (state.trendView === 'line') {
    const totals = trendMonthlyData.map(d => d.needs + d.wants + d.investments);
    const path = totals.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(v)}`).join(' ');
    const points = totals.map((v, i) => `<circle class="trend-point" data-index="${i}" cx="${x(i)}" cy="${y(v)}" r="6" fill="var(--color-accent-needs)"/>`).join('');
    svg.innerHTML = `${yGrid}${xLabels}<path d="${path}" fill="none" stroke="var(--color-accent-needs)" stroke-width="2.5"/>${points}`;
  } else {
    const bars = trendMonthlyData.map((d, i) => {
      const total = d.needs + d.wants + d.investments;
      const bw = 30;
      const bx = x(i) - bw / 2;
      const yNeeds = y(d.needs);
      const yWants = y(d.needs + d.wants);
      const yTotal = y(total);
      return `
        <g>
          <rect class="trend-bar" data-index="${i}" data-cat="Needs" x="${bx}" y="${yNeeds}" width="${bw}" height="${y(0) - yNeeds}" fill="var(--color-accent-needs)"/>
          <rect class="trend-bar" data-index="${i}" data-cat="Wants" x="${bx}" y="${yWants}" width="${bw}" height="${yNeeds - yWants}" fill="var(--color-accent-wants)"/>
          <rect class="trend-bar" data-index="${i}" data-cat="Investments" x="${bx}" y="${yTotal}" width="${bw}" height="${yWants - yTotal}" fill="var(--color-accent-savings)"/>
        </g>
      `;
    }).join('');
    svg.innerHTML = `${yGrid}${xLabels}${bars}`;
  }

  if (tooltip) tooltip.textContent = '';
  svg.querySelectorAll('.trend-point').forEach(point => {
    point.addEventListener('click', () => {
      const i = Number(point.dataset.index);
      const d = trendMonthlyData[i];
      const total = d.needs + d.wants + d.investments;
      if (tooltip) tooltip.textContent = `${d.month}: $${total}`;
    });
  });

  svg.querySelectorAll('.trend-bar').forEach(bar => {
    bar.addEventListener('click', () => {
      const i = Number(bar.dataset.index);
      const cat = bar.dataset.cat;
      const d = trendMonthlyData[i];
      const val = cat === 'Needs' ? d.needs : cat === 'Wants' ? d.wants : d.investments;
      if (tooltip) tooltip.textContent = `${d.month} ${cat}: $${val}`;
    });
  });
}

function renderCategoryRows() {
  const list = document.getElementById('category-list');
  if (!list) return;
  if (categoryBreakdown.length === 0) { list.innerHTML = ''; return; }
  list.innerHTML = categoryBreakdown.map(item => `
    <article class="category-row" data-category="${item.category}">
      <div class="tx-icon"><i class="ph ${iconForCategory(item.category)}"></i></div>
      <div>
        <div>${item.category}</div>
        <div class="mini-progress"><span style="width:${item.percent}%;background:${item.color}"></span></div>
      </div>
      <div class="category-amount"><b>${fmt(item.amount)}</b><small>${item.percent}%</small></div>
      <i class="ph ph-caret-right caret"></i>
    </article>
  `).join('');

  list.querySelectorAll('.category-row').forEach(row => {
    row.addEventListener('click', () => openCategoryDetail(row.dataset.category));
  });
}

function openCategoryDetail(category) {
  const panel = document.getElementById('category-detail');
  const title = document.getElementById('category-detail-title');
  const close = document.getElementById('close-category-detail');
  const list = document.getElementById('category-detail-list');
  if (!panel || !title || !close || !list) return;
  title.textContent = category || 'Category';
  const rows = transactions.filter(tx => tx.category === category);
  if (rows.length === 0) {
    list.innerHTML = '<div class="empty-state"><p style="color:var(--color-text-secondary)">No transactions in this category</p></div>';
  } else {
    list.innerHTML = rows.map(tx => {
      const sign = tx.amount >= 0 ? '+' : '−';
      const amountClass = tx.amount >= 0 ? 'income-text' : 'expense-text';
      return `
        <article class="tx-card" data-id="${tx.id}">
          <div class="tx-icon"><i class="ph ${iconForCategory(tx.category)}"></i></div>
          <div class="tx-main">
            <strong>${tx.name}</strong>
            <small>${tx.merchant} · ${tx.category}</small>
          </div>
          <div class="tx-amount">
            <b class="${amountClass}">${sign}${fmt(Math.abs(tx.amount))}</b>
            <small>${tx.time}</small>
          </div>
        </article>
      `;
    }).join('');
    list.querySelectorAll('.tx-card').forEach(card => {
      card.addEventListener('click', () => openTransactionDetail(card.dataset.id));
    });
  }
  renderCategoryMiniChart(category);
  panel.classList.add('show');
  close.onclick = () => {
    panel.classList.remove('show');
    fullRender();
  };
}

function renderCategoryMiniChart(category) {
  const svg = document.getElementById('category-mini-chart');
  if (!svg) return;
  const w = 330;
  const h = 140;
  const left = 24;
  const right = 10;
  const top = 10;
  const bottom = 20;
  const chartW = w - left - right;
  const chartH = h - top - bottom;
  const series = trendMonthlyData.map(d => {
    if (category === 'Food') return d.needs * 0.6;
    if (category === 'Transport') return d.needs * 0.15;
    if (category === 'Shopping') return d.wants * 0.3;
    if (category === 'Dining') return d.wants * 0.35;
    if (category === 'Health') return d.needs * 0.1;
    if (category === 'Utilities') return d.needs * 0.1;
    if (category === 'Entertainment') return d.wants * 0.2;
    if (category === 'Travel') return d.wants * 0.15;
    return d.investments;
  });
  const max = Math.max(...series, 1);
  const y = value => top + chartH - (value / max) * chartH;
  const x = i => left + (i / (series.length - 1)) * chartW;
  const path = series.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(v)}`).join(' ');
  const labels = trendMonthlyData.map((d, i) => `<text x="${x(i)}" y="${h - 2}" text-anchor="middle" font-size="10" fill="var(--color-text-secondary)">${d.month}</text>`).join('');
  svg.innerHTML = `${labels}<path d="${path}" fill="none" stroke="var(--color-accent-needs)" stroke-width="2.5"/>`;
}

function renderBudgetRule() {
  const container = document.getElementById('budget-rule-container');
  const badge = document.getElementById('rule-status-badge');
  if (!container) return;

  const t = state.budgetTargets;
  const targets = { Needs: t.needs, Wants: t.wants, Investments: t.investments };
  const colors = { Needs: 'var(--color-accent-needs)', Wants: 'var(--color-accent-wants)', Investments: 'var(--color-accent-savings)' };
  const totalSpent = budgetData.segments.reduce((sum, s) => sum + s.spent, 0) || 1;
  const tolerance = state.budgetTolerance;

  let allOnTrack = true;
  const rows = budgetData.segments.map(seg => {
    const actualPct = Math.round((seg.spent / totalSpent) * 100);
    const targetPct = targets[seg.name];
    const diff = actualPct - targetPct;
    const absDiff = Math.abs(diff);
    const isOver = diff > 0;
    const diffClass = absDiff <= tolerance ? 'on-target' : isOver ? 'over' : 'under';
    const diffText = absDiff <= tolerance ? 'on track' : isOver ? `+${absDiff}% over` : `−${absDiff}% under`;
    const color = colors[seg.name] || 'var(--color-text-secondary)';

    if (absDiff > tolerance) allOnTrack = false;

    return `
      <div class="rule-row">
        <div>
          <div class="rule-label-row">
            <span class="rule-name">${seg.name}</span>
            <span class="rule-pcts">${targetPct}% target · ${actualPct}% actual</span>
          </div>
          <div class="rule-bars">
            <div class="rule-bar-track"><div class="rule-bar-fill target" style="width:${targetPct}%;background:${color}"></div></div>
            <div class="rule-bar-track"><div class="rule-bar-fill" style="width:${Math.min(actualPct, 100)}%;background:${color}"></div></div>
          </div>
        </div>
        <span class="rule-diff ${diffClass}">${diffText}</span>
      </div>
    `;
  }).join('');

  container.innerHTML = `<div class="rule-card">${rows}</div>`;
  if (badge) {
    badge.textContent = allOnTrack ? 'On Track' : 'Needs Work';
    badge.classList.toggle('needs-work', !allOnTrack);
  }
}

function renderHomeBudgetRule() {
  const container = document.getElementById('home-budget-rule');
  if (!container) return;

  const t = state.budgetTargets;
  const targets = { Needs: t.needs, Wants: t.wants, Investments: t.investments };
  const colors = { Needs: 'var(--color-accent-needs)', Wants: 'var(--color-accent-wants)', Investments: 'var(--color-accent-savings)' };
  const totalSpent = budgetData.segments.reduce((sum, s) => sum + s.spent, 0) || 1;

  const cx = 40, cy = 40, r = 36;
  let currentAngle = -90;
  const arcs = budgetData.segments.map(seg => {
    const pct = (seg.spent / totalSpent) * 100;
    const angle = (pct / 100) * 360;
    const startAngle = currentAngle;
    const endAngle = currentAngle + angle;
    const x1 = cx + r * Math.cos(startAngle * Math.PI / 180);
    const y1 = cy + r * Math.sin(startAngle * Math.PI / 180);
    const x2 = cx + r * Math.cos(endAngle * Math.PI / 180);
    const y2 = cy + r * Math.sin(endAngle * Math.PI / 180);
    const largeArc = angle > 180 ? 1 : 0;
    currentAngle = endAngle;
    return `<path d="M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z" fill="${colors[seg.name]}" opacity="0.85"/>`;
  }).join('');

  const rows = budgetData.segments.map(seg => {
    const actualPct = Math.round((seg.spent / totalSpent) * 100);
    const targetPct = targets[seg.name];
    return `
      <div class="home-rule-row">
        <div class="home-rule-row-left">
          <span class="home-rule-dot" style="background:${colors[seg.name]}"></span>
          <span class="home-rule-row-name">${seg.name}</span>
        </div>
        <div class="home-rule-metrics">
          <div class="home-rule-metric">
            <span class="home-rule-label">Plan</span>
            <span class="home-rule-value">${targetPct}%</span>
          </div>
          <div class="home-rule-metric">
            <span class="home-rule-label">Reality</span>
            <span class="home-rule-value">${actualPct}%</span>
          </div>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div class="home-rule-card">
      <div class="home-rule-head">
        <h3>50/30/20 Rule</h3>
      </div>
      <div class="home-rule-body">
        <svg class="home-rule-pie" width="80" height="80" viewBox="0 0 80 80">${arcs}</svg>
        <div class="home-rule-rows">${rows}</div>
      </div>
    </div>
  `;
}

function renderComparisons() {
  const list = document.getElementById('comparison-list');
  if (!list) return;
  if (categoryBreakdown.length === 0) { list.innerHTML = ''; return; }
  // Compute last month's category totals
  const today = new Date();
  const lastMonthDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const lastMonthKey = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}`;
  const lastMonthTx = transactions.filter(t => !t.isExcluded && t.date.slice(0, 7) === lastMonthKey && t.type === 'Expense');
  const lastMonth = {};
  lastMonthTx.forEach(t => {
    const amt = Math.abs(t.amount);
    lastMonth[t.category] = (lastMonth[t.category] || 0) + amt;
  });
  list.innerHTML = categoryBreakdown.map(item => {
    const lm = lastMonth[item.category] || item.amount;
    const delta = item.amount - lm;
    const dColor = delta > 0 ? 'var(--color-expense-red)' : 'var(--color-income-green)';
    return `
      <div class="compare-card">
        <strong>${item.category}</strong>
        <div class="compare-row">
          <span class="label">This</span>
          <div class="compare-bars"><div class="bar" style="width:${Math.min(100, (item.amount / 900) * 100)}%;background:${item.color}"></div><div class="bar-last" style="width:${Math.min(100, (lm / 900) * 100)}%;background:${item.color}"></div></div>
          <span style="color:${dColor};font-size:12px">${delta >= 0 ? '+' : '−'}${currencySymbol()}${Math.abs(Math.round(delta))}</span>
        </div>
      </div>
    `;
  }).join('');
}

function processRecurringTransactions() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const user = currentUser;
  const toAdd = [];

  for (const tx of transactions) {
    if (!tx.isRecurring || !tx.recurringInterval) continue;
    const txDate = new Date(tx.date + 'T12:00:00');
    if (txDate > today) continue;

    let count = 0;
    let nextDate = new Date(txDate);
    const maxGenerations = 12;

    while (nextDate <= today && count < maxGenerations) {
      if (tx.recurringInterval === 'weekly') nextDate.setDate(nextDate.getDate() + 7);
      else if (tx.recurringInterval === 'monthly') nextDate.setMonth(nextDate.getMonth() + 1);
      else if (tx.recurringInterval === 'yearly') nextDate.setFullYear(nextDate.getFullYear() + 1);
      else break;
      count++;
    }

    if (count === 0) continue;

    for (let i = 0; i < count; i++) {
      const copyDate = new Date(txDate);
      if (tx.recurringInterval === 'weekly') copyDate.setDate(copyDate.getDate() + 7 * (i + 1));
      else if (tx.recurringInterval === 'monthly') copyDate.setMonth(copyDate.getMonth() + (i + 1));
      else if (tx.recurringInterval === 'yearly') copyDate.setFullYear(copyDate.getFullYear() + (i + 1));
      const dateStr = localDateStr(copyDate);

      if (transactions.some(t => t.name === tx.name && t.date === dateStr && t.amount === tx.amount)) continue;

      const copy = {
        id: user ? `opt-${Date.now()}-${i}` : `t${Date.now()}-${i}`,
        name: tx.name,
        merchant: tx.merchant,
        category: tx.category,
        budgetCategory: tx.budgetCategory,
        amount: tx.amount,
        type: tx.type,
        time: tx.time,
        date: dateStr,
        paymentSource: tx.paymentSource,
        notes: '',
        tags: [],
        isExcluded: false,
        isRecurring: true,
        recurringInterval: tx.recurringInterval,
        receiptUrl: null,
        group: computeDateGroup(dateStr)
      };
      toAdd.push(copy);

      if (user) {
        const { id, group, ...rest } = copy;
        sb.addTransaction(user.uid, rest).catch(err => console.error('Recurring copy save failed:', err));
      }
    }
  }

  if (toAdd.length > 0) {
    toAdd.reverse().forEach(t => transactions.unshift(t));
    saveStorage();
  }
}

function fullRender() {
  processRecurringTransactions();
  updateMetricsFromTransactions();
  renderLegend();
  renderHalfDonut();
  renderCashFlow();
  renderTransactions();
  renderCategoryRows();
  renderHomeBudgetRule();
  renderBudgetRule();
  renderComparisons();
  renderTrendChart();
  renderAlerts();
  renderGoalsCard();
  if (categoryBreakdown[0]) renderCategoryMiniChart(categoryBreakdown[0].category);
  updateAlertBadge();
}

function seedFirestoreData(user) {
  const txs = transactions.map(tx => {
    const { id, group, ...rest } = tx;
    return rest;
  });
  sb.bulkInsertTransactions(user.uid, txs).catch(err => console.error('Seed failed:', err));
  sb.savePreferences(user.uid, {
    currency: 'EUR',
    darkMode: false,
    notifications: true,
    bankSync: true
  }).catch(err => console.error('Seed prefs failed:', err));
}

function syncSettingsToFirestore() {
  const user = currentUser;
  if (!user) return;
  sb.savePreferences(user.uid, {
    currency: state.currency,
    darkMode: state.darkMode,
    notifications: state.notifications,
    bankSync: state.bankSync,
    budgetTargets: state.budgetTargets,
    budgetTolerance: state.budgetTolerance,
    defaultPaymentSource: state.defaultPaymentSource,
    defaultBudgetCategory: state.defaultBudgetCategory,
    monthlyIncome: state.monthlyIncome,
    filterMaxAmount: state.filterMaxAmount,
    holdHintShown: state.holdHintShown
  }).catch(err => console.error('Settings sync failed:', err));
}

// ====== ONBOARDING ======

const onboardingData = {
  income: 0,
  quizAnswers: [],
  quizCorrect: 0,
  goals: []
};

const quizQuestions = [
  {
    question: "What does the 50/30/20 rule suggest?",
    options: ["50% Needs, 30% Wants, 20% Savings", "50% Savings, 30% Needs, 20% Wants", "20% Needs, 50% Wants, 30% Savings"],
    correct: 0,
    explanation: "The 50/30/20 rule splits after-tax income into: 50% for needs (rent, bills, groceries), 30% for wants (dining out, shopping), and 20% for savings and investments."
  },
  {
    question: "An emergency fund should cover how many months of expenses?",
    options: ["1 month", "3-6 months", "12-18 months"],
    correct: 1,
    explanation: "Financial experts recommend saving 3-6 months of essential expenses to cover job loss, medical emergencies, or unexpected repairs."
  },
  {
    question: "Which of these is considered a 'Need' in budgeting?",
    options: ["Streaming subscriptions", "Dining out", "Rent or mortgage"],
    correct: 2,
    explanation: "Needs are essentials required for survival and basic functioning: housing, utilities, groceries, transportation, and healthcare."
  },
  {
    question: "What is compound interest?",
    options: ["Interest paid once at the end of a loan", "Interest on both principal AND accumulated interest", "Interest that decreases over time"],
    correct: 1,
    explanation: "Compound interest means you earn interest on your original savings plus on the interest those savings have already earned — it grows exponentially over time."
  }
];

let currentQuizIndex = 0;
let commitmentHeld = false;

function showOnboarding(user) {
  const screen = document.getElementById('onboarding-screen');
  if (!screen) return;
  screen.classList.add('show');
  const tabBar = document.getElementById('tab-bar');
  const fab = document.getElementById('fab');
  if (tabBar) tabBar.style.display = 'none';
  if (fab) fab.style.display = 'none';

  const incomeInput = document.getElementById('os-income');
  const incomeNext = document.getElementById('os-income-next');
  if (incomeInput && incomeNext) {
    incomeInput.value = '';
    incomeInput.addEventListener('input', () => {
      const val = parseFloat(incomeInput.value);
      incomeNext.disabled = !(val > 0);
    });
  }

  initOnboardingQuiz();
  initGoals();
  initCommitmentRing();
  initSkipHandlers();

  document.querySelectorAll('.os-next').forEach(btn => {
    btn.addEventListener('click', (e) => {
      haptic('medium');
      const to = parseInt(e.currentTarget.dataset.to);
      if (isNaN(to)) return;
      const from = to - 1;
      if (from === 1) {
        const val = parseFloat(incomeInput?.value || '0');
        if (!(val > 0)) return;
        onboardingData.income = val;
      }
      goToOnboardingStep(from, to);
    });
  });

  const finishBtn = document.getElementById('os-finish');
  if (finishBtn) {
    finishBtn.addEventListener('click', () => {
      haptic('success');
      finishOnboarding(user);
    });
  }
}

function goToOnboardingStep(from, to) {
  const current = document.querySelector(`.onboarding-step[data-step="${from}"]`);
  const next = document.querySelector(`.onboarding-step[data-step="${to}"]`);
  if (!current || !next) return;

  current.classList.remove('active');
  next.classList.add('active');

  // Update dots
  const dots = next.querySelectorAll('.onboarding-dots .dot');
  if (dots.length) {
    dots.forEach((d, i) => d.classList.toggle('active', i === to - 1));
  }

  // Show/hide dots on done step
  if (to === 6) {
    document.querySelectorAll('.onboarding-dots').forEach(d => d.style.display = 'none');
  } else {
    document.querySelectorAll('.onboarding-dots').forEach(d => d.style.display = 'flex');
  }

  // Populate motivation step (step 5 → index 5, arrived at from step 4)
  if (to === 5) {
    populateMotivationStep();
  }

  // Populate done step (step 6)
  if (to === 6) {
    populateDoneStep();
  }
}

function populateMotivationStep() {
  const savingsEl = document.getElementById('os-motivation-savings');
  const tipEl = document.getElementById('os-quiz-tip');
  const income = onboardingData.income || 4000; // fallback

  // Estimated annual savings: ~20% overspend avoidance on ~30% discretionary = 6% of income
  const monthlySavings = Math.round(income * 0.06);
  const yearlySavings = monthlySavings * 12;
  const sym = currencySymbol();
  if (savingsEl) {
    savingsEl.textContent = `By tracking your spending, you could save up to ${sym}${yearlySavings.toLocaleString('en-US')} per year!`;
  }

  // Show a quiz tip based on their best result
  const bestQuestion = quizQuestions[onboardingData.quizCorrect > 0 ? 0 : quizQuestions.length - 1];
  if (tipEl) {
    const wasCorrect = onboardingData.quizCorrect > 0;
    tipEl.innerHTML = `<i class="ph ph-${wasCorrect ? 'check-circle' : 'lightbulb'}" style="margin-right:6px"></i> ${wasCorrect ? 'Great job!' : 'Tip:'} ${bestQuestion.explanation}`;
  }
}

function populateDoneStep() {
  const heading = document.getElementById('os-done-heading');
  const summary = document.getElementById('os-summary');
  const name = currentUser?.displayName?.split(' ')[0] || 'there';
  if (heading) heading.textContent = `You're all set, ${name}!`;

  if (summary) {
    const sym = currencySymbol();
    const items = [];
    items.push(`<div class="os-summary-item"><span>Monthly Income</span><span>${sym}${(onboardingData.income || 0).toLocaleString('en-US')}</span></div>`);
    items.push(`<div class="os-summary-item"><span>Financial Goals</span><span>${onboardingData.goals.length > 0 ? onboardingData.goals.length + ' selected' : 'Skipped'}</span></div>`);
    items.push(`<div class="os-summary-item"><span>Quiz Score</span><span>${onboardingData.quizCorrect}/${quizQuestions.length}</span></div>`);
    items.push(`<div class="os-summary-item"><span>Commitment</span><span>${commitmentHeld ? 'Made' : 'Skipped'}</span></div>`);
    summary.innerHTML = items.join('');
  }
}

function initOnboardingQuiz() {
  currentQuizIndex = 0;
  const container = document.getElementById('os-quiz-container');
  const progress = document.getElementById('os-quiz-progress');
  const nextBtn = document.getElementById('os-quiz-next');
  if (!container) return;

  function renderQuestion() {
    if (currentQuizIndex >= quizQuestions.length) {
      // Quiz done — auto-advance
      const from = document.querySelector('.onboarding-step.active')?.dataset.step;
      goToOnboardingStep(parseInt(from), parseInt(from) + 1);
      return;
    }
    const q = quizQuestions[currentQuizIndex];
    if (progress) progress.textContent = `Question ${currentQuizIndex + 1} of ${quizQuestions.length}`;
    nextBtn.style.display = 'none';

    container.innerHTML = `
      <div class="os-quiz-question animate-in" style="--delay:0ms">
        <p>${q.question}</p>
        <div class="os-quiz-options">
          ${q.options.map((opt, i) => `<button class="os-quiz-option" data-index="${i}">${opt}</button>`).join('')}
        </div>
      </div>
    `;

    container.querySelectorAll('.os-quiz-option').forEach(opt => {
      opt.addEventListener('click', () => {
        if (container.querySelector('.os-quiz-feedback')) return; // already answered

        const idx = parseInt(opt.dataset.index);
        const isCorrect = idx === q.correct;

        onboardingData.quizAnswers.push(idx);
        if (isCorrect) onboardingData.quizCorrect++;

        // Mark correct/incorrect
        container.querySelectorAll('.os-quiz-option').forEach((el, i) => {
          el.classList.remove('selected');
          if (i === q.correct) el.classList.add('correct');
          if (i === idx && !isCorrect) el.classList.add('incorrect');
        });
        opt.classList.add('selected');

        // Show feedback
        const feedback = document.createElement('div');
        feedback.className = 'os-quiz-feedback animate-in';
        feedback.style.setProperty('--delay', '80ms');
        feedback.innerHTML = `<strong>${isCorrect ? 'Correct!' : 'Not quite.'}</strong> ${q.explanation}`;
        container.appendChild(feedback);

        currentQuizIndex++;
        nextBtn.style.display = 'block';
      });
    });

    setTimeout(() => {
      container.querySelectorAll('.animate-in').forEach(el => el.classList.remove('animate-in'));
    }, 300);
  }

  renderQuestion();
  nextBtn.addEventListener('click', renderQuestion);
}

function initGoals() {
  const grid = document.getElementById('os-goals-grid');
  const nextBtn = document.getElementById('os-goals-next');
  if (!grid) return;

  grid.querySelectorAll('.os-goal').forEach(btn => {
    btn.addEventListener('click', () => {
      haptic('light');
      btn.classList.toggle('selected');
      onboardingData.goals = [...grid.querySelectorAll('.os-goal.selected')].map(el => el.dataset.goal);
      nextBtn.disabled = onboardingData.goals.length === 0;
    });
  });
}

function initCommitmentRing() {
  const wrap = document.getElementById('commitment-ring');
  const fill = document.getElementById('commit-fill');
  const statusText = document.getElementById('commitment-status');
  const text = document.getElementById('commitment-text');
  const nextBtn = document.getElementById('os-commit-next');
  if (!wrap || !fill) return;

  commitmentHeld = false;
  const circumference = 314.159;
  let startTime = 0;
  let held = 0;
  let animId = null;
  let holding = false;

  wrap.classList.add('idle');

  function updateRing() {
    if (!holding) return;
    held = Math.min((Date.now() - startTime) / 3000, 1);
    fill.style.strokeDashoffset = circumference * (1 - held);

    if (held < 0.5) {
      if (statusText) statusText.textContent = 'Hold for 3 seconds...';
    } else if (held < 1) {
      if (statusText) statusText.textContent = 'Almost there...';
    }

    if (held >= 1) {
      holding = false;
      commitmentHeld = true;
      if (text) text.innerHTML = '&#10003; Committed!';
      if (statusText) statusText.textContent = 'You did it!';
      if (nextBtn) nextBtn.style.display = 'block';
      wrap.classList.remove('idle');
      wrap.classList.add('committed');
      navigator.vibrate?.(200);
      return;
    }
    animId = requestAnimationFrame(updateRing);
  }

  function startHold() {
    if (commitmentHeld) return;
    holding = true;
    startTime = Date.now();
    wrap.classList.remove('idle');
    if (statusText) statusText.textContent = 'Hold for 3 seconds...';
    animId = requestAnimationFrame(updateRing);
  }

  function endHold() {
    if (commitmentHeld) return;
    holding = false;
    if (animId) cancelAnimationFrame(animId);
    if (held < 1) {
      fill.style.transition = 'stroke-dashoffset 300ms ease';
      fill.style.strokeDashoffset = circumference;
      setTimeout(() => { fill.style.transition = 'stroke-dashoffset 50ms linear'; }, 300);
      if (statusText) statusText.textContent = 'Hold for 3 seconds';
      wrap.classList.add('idle');
    }
    held = 0;
  }

  wrap.addEventListener('pointerdown', startHold);
  wrap.addEventListener('pointerup', endHold);
  wrap.addEventListener('pointerleave', endHold);
}

function initSkipHandlers() {
  const skipConfirm = document.getElementById('skip-confirm');
  const skipClose = document.getElementById('skip-close');
  const skipYes = document.getElementById('skip-confirm-yes');

  document.querySelectorAll('.os-skip').forEach(btn => {
    btn.addEventListener('click', () => {
      haptic('light');
      skipConfirm.style.display = 'flex';
    });
  });

  const skipFromWelcome = document.getElementById('os-skip-0');
  if (skipFromWelcome) {
    skipFromWelcome.addEventListener('click', () => {
      haptic('light');
      skipConfirm.style.display = 'flex';
    });
  }

  if (skipClose) {
    skipClose.addEventListener('click', () => {
      haptic('light');
      skipConfirm.style.display = 'none';
    });
  }

  if (skipYes) {
    skipYes.addEventListener('click', () => {
      haptic('medium');
      skipConfirm.style.display = 'none';
      const user = currentUser;
      if (user) finishOnboarding(user);
    });
  }
}

function finishOnboarding(user) {
  const screen = document.getElementById('onboarding-screen');
  if (screen) screen.classList.remove('show');
  const tabBar = document.getElementById('tab-bar');
  const fab = document.getElementById('fab');
  if (tabBar) tabBar.style.display = 'grid';
  if (fab) fab.style.display = 'block';

  // Write settings + onboarding doc to Supabase
  sb.savePreferences(user.uid, {
    currency: 'EUR',
    darkMode: false,
    notifications: true,
    bankSync: true,
    budgetTargets: state.budgetTargets,
    budgetTolerance: state.budgetTolerance,
    defaultPaymentSource: state.defaultPaymentSource,
    defaultBudgetCategory: state.defaultBudgetCategory,
    monthlyIncome: onboardingData.income,
    filterMaxAmount: state.filterMaxAmount
  }).catch(err => console.error('Settings write failed:', err));

  sb.saveOnboarding(user.uid, {
    completed: true,
    completedAt: new Date().toISOString(),
    income: onboardingData.income,
    goals: onboardingData.goals,
    quizCorrect: onboardingData.quizCorrect
  }).catch(err => console.error('Onboarding write failed:', err));

  // Store onboarding data into state
  if (onboardingData.income > 0) {
    state.monthlyIncome = onboardingData.income;
    budgetData.totalBudget = onboardingData.income;
    budgetData.remaining = onboardingData.income;
    // Create an income transaction so downstream calculations work correctly
    const today = new Date();
    const firstOfMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
    const incomeTx = {
      id: `opt-${Date.now()}`,
      name: 'Monthly Income',
      merchant: 'Monthly Income',
      category: 'Other',
      budgetCategory: state.defaultBudgetCategory,
      amount: Math.abs(onboardingData.income),
      type: 'Income',
      time: '00:01',
      date: firstOfMonth,
      paymentSource: state.defaultPaymentSource,
      notes: '',
      tags: [],
      isExcluded: false,
      isRecurring: false,
      recurringInterval: null,
      group: computeDateGroup(firstOfMonth)
    };
    transactions.unshift(incomeTx);
    saveStorage();
    if (user) {
      const { id, group, ...txData } = incomeTx;
      sb.addTransaction(user.uid, txData).catch(err => console.error('Income tx save failed:', err));
    }
  }
  if (onboardingData.goals.length > 0) state.goals = onboardingData.goals;

  syncSettingsToFirestore();
  fullRender();
  setTimeout(() => showNotificationPrompt(user), 500);
}

// ── Haptic feedback ─────────────────────────────────────────────
function haptic(type = 'light') {
  const durations = { light: 10, medium: 20, heavy: 30, success: 50 };
  const styles = { light: 'Light', medium: 'Medium', heavy: 'Heavy', success: 'Heavy' };

  try {
    if (window.Capacitor?.isPluginAvailable?.('Haptics')) {
      window.Capacitor.Plugins.Haptics.impact({ style: styles[type] || 'Light' });
      return;
    }
  } catch (e) {}

  if (navigator.vibrate) {
    navigator.vibrate(durations[type] || 10);
  }
}

// ── Notification permission prompt ──────────────────────────────
function showNotificationPrompt(user) {
  if (!user) return;
  if (state.notifications === false) return;
  if (Notification.permission === 'granted') return;

  const el = document.getElementById('notification-overlay');
  if (!el) return;
  el.style.display = 'flex';

  const accept = document.getElementById('notif-accept');
  const decline = document.getElementById('notif-decline');

  function dismiss() {
    el.style.display = 'none';
    el.removeEventListener('click', onBackdrop);
  }

  function onBackdrop(e) {
    if (e.target === el) dismiss();
  }

  accept?.addEventListener('click', async () => {
    haptic('medium');
    dismiss();
    await registerNativePush(user);
  });

  decline?.addEventListener('click', () => {
    haptic('light');
    dismiss();
  });

  el.addEventListener('click', onBackdrop);
}


