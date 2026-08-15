/**
 * auth.js — Optional Supabase Auth (login/register)
 * Anonymous flow continues working regardless of auth state.
 */

import { supabase } from './supabase-client.js';

// DOM refs
const authModal     = document.getElementById('auth-modal');
const btnLogin      = document.getElementById('btn-login');
const userAvatar    = document.getElementById('user-avatar');
const avatarInitials= document.getElementById('avatar-initials');
const avatarEmail   = document.getElementById('avatar-email');
const avatarDropdown= document.getElementById('avatar-dropdown');
const btnLogout     = document.getElementById('btn-logout');
const btnAuthCancel = document.getElementById('btn-auth-cancel');
const btnAuthSubmit = document.getElementById('btn-auth-submit');
const authEmailInput= document.getElementById('auth-email');
const authPassInput = document.getElementById('auth-password');
const authError     = document.getElementById('auth-error');
const authTabs      = document.querySelectorAll('.auth-tab');

let currentTab = 'register'; // 'register' | 'login'

// ── Helpers ──────────────────────────────────────────────────
function showError(msg) {
  authError.textContent = msg;
  authError.classList.remove('hidden');
}
function clearError() {
  authError.classList.add('hidden');
}

function setLoggedIn(user) {
  const initials = user.email.slice(0, 2).toUpperCase();
  avatarInitials.textContent = initials;
  avatarEmail.textContent = user.email;
  userAvatar.title = user.email;

  btnLogin.classList.add('hidden');
  userAvatar.classList.remove('hidden');
}

function setLoggedOut() {
  btnLogin.classList.remove('hidden');
  userAvatar.classList.add('hidden');
  avatarDropdown.classList.add('hidden');
}

function openModal() {
  authEmailInput.value = '';
  authPassInput.value = '';
  clearError();
  authModal.classList.remove('hidden');
}

function closeModal() {
  authModal.classList.add('hidden');
}

// ── Tab switching ─────────────────────────────────────────────
authTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    currentTab = tab.dataset.tab;
    authTabs.forEach(t => t.classList.toggle('active', t.dataset.tab === currentTab));
    btnAuthSubmit.textContent = currentTab === 'register' ? 'Registrarse' : 'Iniciar sesión';
    clearError();
  });
});

// ── Submit ────────────────────────────────────────────────────
btnAuthSubmit.addEventListener('click', async () => {
  const email    = authEmailInput.value.trim();
  const password = authPassInput.value;

  if (!email || !password) { showError('Completá email y contraseña.'); return; }

  clearError();
  btnAuthSubmit.disabled = true;
  btnAuthSubmit.textContent = '...';

  let result;
  if (currentTab === 'register') {
    result = await supabase.auth.signUp({ email, password });
  } else {
    result = await supabase.auth.signInWithPassword({ email, password });
  }

  btnAuthSubmit.disabled = false;
  btnAuthSubmit.textContent = currentTab === 'register' ? 'Registrarse' : 'Iniciar sesión';

  if (result.error) { showError(result.error.message); return; }

  const user = result.data.user;
  if (!user) {
    // signUp with email confirmation enabled → user is null until confirmed
    showError('Revisá tu email para confirmar el registro.');
    return;
  }

  closeModal();
  setLoggedIn(user);
  linkFingerprint(user.id);
});

// ── Avatar dropdown ───────────────────────────────────────────
userAvatar.addEventListener('click', (e) => {
  e.stopPropagation();
  avatarDropdown.classList.toggle('hidden');
});

document.addEventListener('click', () => {
  avatarDropdown.classList.add('hidden');
});

btnLogout.addEventListener('click', async () => {
  await supabase.auth.signOut();
  setLoggedOut();
});

// ── Open / Close modal ────────────────────────────────────────
btnLogin.addEventListener('click', openModal);
btnAuthCancel.addEventListener('click', closeModal);
authModal.addEventListener('click', (e) => {
  if (e.target === authModal) closeModal();
});

// ── Link fingerprint to account ───────────────────────────────
async function linkFingerprint(userId) {
  // fingerprint may not be ready yet; read from window if app.js stored it
  const fp = window.__camreal_fingerprint;
  if (!fp || !userId) return;
  await supabase.from('usuarios_perfil').upsert(
    { id: userId, fingerprint: fp },
    { onConflict: 'id' }
  );
}

// ── Restore session on load ───────────────────────────────────
export async function initAuth(fingerprint) {
  // Store fingerprint globally so linkFingerprint can access it
  window.__camreal_fingerprint = fingerprint;

  const { data } = await supabase.auth.getSession();
  if (data.session?.user) {
    setLoggedIn(data.session.user);
    linkFingerprint(data.session.user.id);
  }
}
