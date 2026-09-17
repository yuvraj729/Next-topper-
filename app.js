// ============================================================
// app.js — Next Toppers site logic (module script)
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, doc, getDoc, onSnapshot, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

// ---- CHANGE THIS before deploying ----
const ADMIN_PASSWORD = "@sk804936";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const lockRef = doc(db, "settings", "classLock");

document.getElementById('year').textContent = new Date().getFullYear();

// ============================================================
// DATA
// ============================================================
const CLASS_LABELS = { "9":"Class 9th", "10":"Class 10th", "11":"Class 11th", "12":"Class 12th" };
const BATCHES = {
  "9":  ["Aarambh Batch", "Aarambh Batch 2.0", "Abhay Batch"],
  "10": ["Aarambh Batch", "Aarambh Batch 2.0", "Abhay Batch"],
  "11": ["Prarambh Batch (Science)", "Prarambh Batch (Commerce)", "Prarambh / Nirbhay Batch (Humanities)"],
  "12": ["Prarambh Batch (Science)", "Prarambh Batch (Commerce)", "Prarambh / Nirbhay Batch (Humanities)"]
};

let selectedClass = null;
let selectedBatch = null;
let lockState = { locked: false, lockedClass: null };

// ============================================================
// LIVE LOCK STATE (used by both the public class picker and
// the admin status pill)
// ============================================================
onSnapshot(lockRef, (snap) => {
  lockState = snap.exists()
    ? { locked: !!snap.data().locked, lockedClass: snap.data().lockedClass || null }
    : { locked: false, lockedClass: null };

  const classOverlay = document.getElementById('classOverlay');
  if (classOverlay.classList.contains('active')) renderClassOptions();

  const pill = document.getElementById('statusPill');
  if (pill) {
    if (lockState.locked) {
      pill.textContent = 'Locked → ' + (CLASS_LABELS[lockState.lockedClass] || '');
      pill.className = 'status-pill locked';
    } else {
      pill.textContent = 'All classes open';
      pill.className = 'status-pill open';
    }
  }
}, (err) => console.error('Firestore lock listener error:', err));

// ============================================================
// MODAL HELPERS
// ============================================================
window.closeAllModals = function(){
  document.getElementById('classOverlay').classList.remove('active');
  document.getElementById('batchOverlay').classList.remove('active');
  document.getElementById('checkoutOverlay').classList.remove('active');
};

window.openClassModal = function(){
  closeAllModals();
  renderClassOptions();
  document.getElementById('classOverlay').classList.add('active');
};

window.openBatchModal = function(cls){
  selectedClass = cls;
  closeAllModals();
  renderBatchOptions(cls);
  document.getElementById('batchOverlay').classList.add('active');
};

window.openCheckoutModal = function(batchName){
  selectedBatch = batchName;
  closeAllModals();
  document.getElementById('orderSummary').innerHTML =
    `<b>Plan:</b> Next Toppers Premium<br>
     <b>Class:</b> ${CLASS_LABELS[selectedClass]}<br>
     <b>Batch:</b> ${selectedBatch}<br>
     <b>Amount:</b> ₹149`;
  document.getElementById('backToBatch').onclick = () => openBatchModal(selectedClass);
  document.getElementById('checkoutFormWrap').style.display = 'block';
  document.getElementById('checkoutStatusWrap').style.display = 'none';
  document.getElementById('checkoutOverlay').classList.add('active');
};

// ============================================================
// RENDER: CLASS OPTIONS (respects admin lock)
// ============================================================
function renderClassOptions(){
  const listEl = document.getElementById('classOptionList');
  const noticeEl = document.getElementById('lockedNoticeBox');

  noticeEl.innerHTML = lockState.locked
    ? `<div class="locked-note">🔒 Admissions are currently open only for <b>${CLASS_LABELS[lockState.lockedClass] || ''}</b>.</div>`
    : '';

  listEl.innerHTML = '';
  Object.keys(CLASS_LABELS).forEach(cls => {
    const isDisabled = lockState.locked && lockState.lockedClass !== cls;
    const btn = document.createElement('button');
    btn.className = 'option-btn';
    btn.disabled = isDisabled;
    btn.innerHTML = `<span>${CLASS_LABELS[cls]}</span>` + (isDisabled ? '<span class="lock-tag">LOCKED</span>' : '<span>›</span>');
    if (!isDisabled) btn.onclick = () => openBatchModal(cls);
    listEl.appendChild(btn);
  });
}

function renderBatchOptions(cls){
  document.getElementById('batchTitle').textContent = `${CLASS_LABELS[cls]} — Select Batch`;
  document.getElementById('batchSub').textContent = 'Choose the batch you want to join.';
  const listEl = document.getElementById('batchOptionList');
  listEl.innerHTML = '';
  BATCHES[cls].forEach(batchName => {
    const btn = document.createElement('button');
    btn.className = 'option-btn';
    btn.innerHTML = `<span>${batchName}</span><span>›</span>`;
    btn.onclick = () => openCheckoutModal(batchName);
    listEl.appendChild(btn);
  });
}

// ============================================================
// PAYMENT (ZapUPI)
// ============================================================
if (window.ZapUPI) {
  ZapUPI.setPaymentCallbacks({
    onSuccess: (orderId) => handlePaymentResult('success', orderId),
    onFailed:  (orderId) => handlePaymentResult('failed', orderId),
    onTimeout: (orderId) => handlePaymentResult('timeout', orderId)
  });
}

let pendingOrder = null;

window.startPayment = function(){
  const name = document.getElementById('custName').value.trim();
  const phone = document.getElementById('custPhone').value.trim();
  const email = document.getElementById('custEmail').value.trim();

  if (!name || !/^\d{10}$/.test(phone) || !email.includes('@')){
    alert('Please enter a valid name, 10-digit mobile number and email.');
    return;
  }

  const orderId = 'NT' + Date.now();
  pendingOrder = {
    orderId, name, phone, email,
    class: selectedClass, className: CLASS_LABELS[selectedClass],
    batch: selectedBatch, amount: 149
  };

  savePendingOrder(pendingOrder);
  showCheckoutStatus('loading', 'Opening secure payment window…');

  if (!window.ZapUPI){
    showCheckoutStatus('error', 'Payment SDK failed to load. Please check your internet connection and try again.');
    return;
  }

  ZapUPI.createOrder({
    zap_key: "zapf0bc4ab8864806b4e1b1eaf8c5bfa04a",
    order_id: orderId,
    amount: String(pendingOrder.amount)
  });
};

function handlePaymentResult(result, orderId){
  if (result === 'success'){
    markOrderStatus(orderId, 'paid');
    showCheckoutStatus('success', `Payment successful! Your order <b>${orderId}</b> for <b>${pendingOrder ? pendingOrder.className + ' — ' + pendingOrder.batch : ''}</b> is confirmed. You now have Premium access.`);
  } else if (result === 'timeout'){
    markOrderStatus(orderId, 'timeout');
    showCheckoutStatus('timeout', `Payment timed out for order <b>${orderId}</b>. No amount was charged — please try again.`);
  } else {
    markOrderStatus(orderId, 'failed');
    showCheckoutStatus('error', `Payment failed for order <b>${orderId}</b>. Please try again or use a different UPI app.`);
  }
}

function showCheckoutStatus(type, message){
  document.getElementById('checkoutFormWrap').style.display = 'none';
  const wrap = document.getElementById('checkoutStatusWrap');
  wrap.style.display = 'block';
  const icons = { loading:'', success:'✅', error:'❌', timeout:'⏱️' };
  wrap.innerHTML = `
    <div class="status-msg">
      ${type === 'loading' ? '<div class="spinner"></div>' : `<div class="big-icon">${icons[type]}</div>`}
      <p>${message}</p>
      ${type !== 'loading' ? `<button class="buy-btn" onclick="closeAllModals()">Done</button>` : ''}
    </div>`;
}

// ============================================================
// FIRESTORE: order records
// NOTE: writes order status directly from the browser for
// demo/simplicity. For production, verify payment via a
// server-side webhook before granting access — see README.md.
// ============================================================
async function savePendingOrder(order){
  try {
    await setDoc(doc(db, "orders", order.orderId), {
      orderId: order.orderId, name: order.name, phone: order.phone, email: order.email,
      class: order.class, className: order.className, batch: order.batch,
      amount: order.amount, status: "pending", createdAt: serverTimestamp()
    });
  } catch (e){ console.error('Failed to save order:', e); }
}

async function markOrderStatus(orderId, status){
  try {
    await setDoc(doc(db, "orders", orderId), { status, updatedAt: serverTimestamp() }, { merge: true });
  } catch (e){ console.error('Failed to update order:', e); }
}

// ============================================================
// ADMIN PANEL (bottom of page)
// ============================================================
window.tryAdminLogin = function(){
  const val = document.getElementById('adminPass').value;
  if (val === ADMIN_PASSWORD){
    document.getElementById('adminLoginView').style.display = 'none';
    document.getElementById('adminControlView').style.display = 'block';
  } else {
    document.getElementById('adminLoginMsg').textContent = 'Incorrect password.';
  }
};

window.lockClass = async function(){
  const cls = document.getElementById('classSelect').value;
  await setDoc(lockRef, { locked: true, lockedClass: cls });
  document.getElementById('adminControlMsg').textContent = `Locked to Class ${cls}. Other classes are now hidden on the site.`;
};

window.unlockAll = async function(){
  await setDoc(lockRef, { locked: false, lockedClass: null });
  document.getElementById('adminControlMsg').textContent = 'All classes are now open.';
};
