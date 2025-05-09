// Initialize Supabase client (SUPABASE_URL and SUPABASE_ANON_KEY are available globally from index.ejs)
const { createClient } = supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const loginForm = document.getElementById('login-form');
const authSection = document.getElementById('auth-section');
const userSection = document.getElementById('user-section');
const userEmailSpan = document.getElementById('user-email');
const logoutButton = document.getElementById('logout-button');
const authErrorP = document.getElementById('auth-error');

const uploadForm = document.getElementById('upload-form');
const saveFileInput = document.getElementById('savefile');
const versionInput = document.getElementById('version');
const customMetadataInput = document.getElementById('custom_metadata');
const uploadStatusP = document.getElementById('upload-status');

const saveFilesListUL = document.getElementById('save-files-list');
const listStatusP = document.getElementById('list-status');

let currentUser = null;
let currentSession = null;

// --- Authentication ---
async function handleLogin(event) {
  event.preventDefault();
  authErrorP.textContent = '';
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;

  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email: email,
      password: password,
    });

    if (error) {
      authErrorP.textContent = `Login failed: ${error.message}`;
      console.error('Login error:', error);
      return;
    }

    if (data.user && data.session) {
      currentUser = data.user;
      currentSession = data.session;
      updateUIVisibility(true);
      loadSaveFiles();
    } else {
      authErrorP.textContent = 'Login failed. No user data received.';
    }
  } catch (err) {
    authErrorP.textContent = `Login error: ${err.message}`;
    console.error('Login exception:', err);
  }
}

async function handleLogout() {
  const { error } = await supabaseClient.auth.signOut();
  if (error) {
    console.error('Logout error:', error);
    alert('Logout failed: ' + error.message);
  }
  currentUser = null;
  currentSession = null;
  updateUIVisibility(false);
  saveFilesListUL.innerHTML = ''; // Clear list
}

function updateUIVisibility(isLoggedIn) {
  if (isLoggedIn) {
    authSection.style.display = 'none';
    userSection.style.display = 'block';
    userEmailSpan.textContent = currentUser.email;
  } else {
    authSection.style.display = 'block';
    userSection.style.display = 'none';
    userEmailSpan.textContent = '';
  }
}

// --- API Calls & UI Updates ---
async function loadSaveFiles() {
  if (!currentSession) return;
  listStatusP.textContent = 'Loading save files...';
  saveFilesListUL.innerHTML = '';

  try {
    const response = await fetch('/api/saves', {
      headers: {
        Authorization: `Bearer ${currentSession.access_token}`,
      },
    });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
    }
    const files = await response.json();
    listStatusP.textContent = files.length > 0 ? '' : 'No save files found.';
    files.forEach((file) => {
      const li = document.createElement('li');
      li.innerHTML = `
                <strong>${file.file_name}</strong> (v${file.version || 'N/A'}, ${formatBytes(file.size_bytes)}) - 
                Last updated: ${new Date(file.updated_at).toLocaleString()}
                <button class="download-btn" data-filename="${file.file_name}">Download</button>
                <button class="delete-btn" data-filename="${file.file_name}">Delete</button>
                <pre>${file.custom_metadata ? JSON.stringify(file.custom_metadata, null, 2) : ''}</pre>
            `;
      saveFilesListUL.appendChild(li);
    });
  } catch (error) {
    console.error('Error loading save files:', error);
    listStatusP.textContent = `Error: ${error.message}`;
  }
}

async function handleUpload(event) {
  event.preventDefault();
  if (!currentSession || !saveFileInput.files[0]) return;

  uploadStatusP.textContent = 'Uploading...';
  const formData = new FormData();
  formData.append('savefile', saveFileInput.files[0]);
  if (versionInput.value) formData.append('version', versionInput.value);
  if (customMetadataInput.value) {
    try {
      // Validate JSON if needed, or let backend handle it
      JSON.parse(customMetadataInput.value);
      formData.append('custom_metadata', customMetadataInput.value);
    } catch (e) {
      uploadStatusP.textContent = 'Error: Custom metadata is not valid JSON.';
      return;
    }
  }

  try {
    const response = await fetch('/api/saves/upload', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${currentSession.access_token}`,
      },
      body: formData,
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.message || `HTTP error! status: ${response.status}`);
    }
    uploadStatusP.textContent = `Success: ${result.message}`;
    uploadForm.reset();
    loadSaveFiles(); // Refresh list
  } catch (error) {
    console.error('Error uploading file:', error);
    uploadStatusP.textContent = `Error: ${error.message}`;
  }
}

async function handleDownload(fileName) {
  if (!currentSession) return;
  listStatusP.textContent = `Downloading ${fileName}...`;
  try {
    const response = await fetch(`/api/saves/download/${encodeURIComponent(fileName)}`, {
      headers: {
        Authorization: `Bearer ${currentSession.access_token}`,
      },
    });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
    }
    const blob = await response.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
    listStatusP.textContent = `Downloaded ${fileName}.`;
  } catch (error) {
    console.error('Error downloading file:', error);
    listStatusP.textContent = `Error downloading ${fileName}: ${error.message}`;
  }
}

async function handleDelete(fileName) {
  if (!currentSession || !confirm(`Are you sure you want to delete ${fileName}?`)) return;

  listStatusP.textContent = `Deleting ${fileName}...`;
  try {
    const response = await fetch(`/api/saves/${encodeURIComponent(fileName)}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${currentSession.access_token}`,
      },
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.message || `HTTP error! status: ${response.status}`);
    }
    listStatusP.textContent = `Success: ${result.message}`;
    loadSaveFiles(); // Refresh list
  } catch (error) {
    console.error('Error deleting file:', error);
    listStatusP.textContent = `Error deleting ${fileName}: ${error.message}`;
  }
}

// --- Event Listeners ---
loginForm.addEventListener('submit', handleLogin);
logoutButton.addEventListener('click', handleLogout);
uploadForm.addEventListener('submit', handleUpload);

saveFilesListUL.addEventListener('click', (event) => {
  if (event.target.classList.contains('download-btn')) {
    handleDownload(event.target.dataset.filename);
  }
  if (event.target.classList.contains('delete-btn')) {
    handleDelete(event.target.dataset.filename);
  }
});

// --- Utility ---
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// --- Initial Check for Existing Session (e.g., on page load/refresh) ---
async function checkUserSession() {
  const { data, error } = await supabaseClient.auth.getSession();
  if (error) {
    console.error('Error fetching session:', error.message);
    updateUIVisibility(false);
    return;
  }
  if (data.session && data.session.user) {
    currentUser = data.session.user;
    currentSession = data.session;
    updateUIVisibility(true);
    loadSaveFiles();
  } else {
    updateUIVisibility(false);
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  // Check if Supabase client is available (from global scope)
  if (typeof supabase === 'undefined' || typeof supabase.createClient === 'undefined') {
    console.error('Supabase client (supabase.js) not loaded. Make sure it is included before app.js');
    alert('Critical error: Supabase library not found. UI cannot function.');
    return;
  }
  checkUserSession();
});
