/***** renderer.js *****/
const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Global userState
let userState = {
  deviceID: null,
  isPro: false,
  dailyCount: 0,
  dailyDate: null
};
let autoUpdate= false;

// Simple hash for your local testing
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return hash.toString(16);
}

// DOM elements
let selectedFiles = [];
let outputDirectory = null;
let lastDialogTime = 0;

const fileInput = document.getElementById('file-input');
const dropZone = document.getElementById('drop-zone');
const selectFolderBtn = document.getElementById('select-folder');
const fileListDiv = document.getElementById('file-list');
const filesUl = document.getElementById('files-ul');
const clearFilesBtn = document.getElementById('clear-files');
const outputDirInput = document.getElementById('output-dir');
const selectOutputBtn = document.getElementById('select-output');
const processButton = document.getElementById('process-button');
const progress = document.getElementById('progress');
const progressBar = document.querySelector('.progress-bar');
const statusDiv = document.getElementById('status');
const outputLinkDiv = document.getElementById('output-link');
const openOutputFolderLink = document.getElementById('open-output-folder');

// Logs area
const logArea = document.getElementById('log-area');
const logMessages = document.getElementById('log-messages');

// Pro container
const proContainer = document.getElementById('pro-container');
const proButton = document.getElementById('pro-button');
const proInfoLink = document.getElementById('pro-info-link');

// Upgrade modal
const upgradeModal = document.getElementById('upgrade-modal');
const upgradeClose = document.getElementById('upgrade-close');
const deviceIdField = document.getElementById('device-id-field');
const copyDeviceIdBtn = document.getElementById('copy-device-id');
const proKeyInput = document.getElementById('pro-key-input');
const validateKeyBtn = document.getElementById('validate-key-button');
const upgradeStoreBtn = document.getElementById('upgrade-store-btn');
const keyMessageDiv = document.getElementById('key-message'); // for invalid/success messages

// Info modal
const infoModal = document.getElementById('info-modal');
const infoClose = document.getElementById('info-close');

// Manage Plan modal
const manageModal = document.getElementById('manage-modal');
const manageClose = document.getElementById('manage-close');
const downgradeBtn = document.getElementById('downgrade-btn');

// On load: restore output dir
const storedOutput = localStorage.getItem('outputDirectory');
if (storedOutput) {
  outputDirectory = storedOutput;
  outputDirInput.value = storedOutput;
  outputLinkDiv.classList.remove('hidden');
  openOutputFolderLink.onclick = async () => {
    await ipcRenderer.invoke('open-folder', outputDirectory);
  };
}

// Load userState
function loadUserState() {
  const saved = localStorage.getItem('userState');
  if (saved) {
    userState = JSON.parse(saved);
  } else {
    userState = {
      deviceID: null,
      isPro: false,
      dailyCount: 0,
      dailyDate: null
    };
  }
  if (!userState.deviceID) {
    userState.deviceID = generateDeviceID(10);
    saveUserState();
  }
  checkDailyReset();
}

function saveUserState() {
  localStorage.setItem('userState', JSON.stringify(userState));
}

function generateDeviceID(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function checkDailyReset() {
  const today = getLocalDateString();
  if (userState.dailyDate !== today) {
    userState.dailyDate = today;
    userState.dailyCount = 0;
    saveUserState();
  }
}

function getLocalDateString() {
  const now = new Date();
  return now.toLocaleDateString('en-CA'); 
}

loadUserState();
updateProUI();

dropZone.addEventListener('click', () => {
  const now = Date.now();
  if (now - lastDialogTime < 1000) return;
  lastDialogTime = now;
  fileInput.value = "";
  fileInput.click();
});

fileInput.addEventListener('change', async (e) => {
  await handleInputItems(e.target.files);
});

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.style.borderColor = 'var(--accent)';
});
dropZone.addEventListener('dragleave', () => {
  dropZone.style.borderColor = 'var(--text-secondary)';
});
dropZone.addEventListener('drop', async (e) => {
  e.preventDefault();
  dropZone.style.borderColor = 'var(--text-secondary)';
  await handleInputItems(e.dataTransfer.files);
});

selectFolderBtn.addEventListener('click', async () => {
  const folderPath = await ipcRenderer.invoke('select-input-directory');
  if (folderPath) {
    const filesFromFolder = getFilesFromDirectory(folderPath);
    if (filesFromFolder.length === 0) {
      showStatus('No supported files found in the selected folder.', 'error');
    } else {
      filesFromFolder.forEach((f) => addFile(f));
      updateFileListUI();
      updateProcessButton();
    }
  }
});

clearFilesBtn.addEventListener('click', clearState);
selectOutputBtn.addEventListener('click', async () => {
  outputDirectory = await ipcRenderer.invoke('select-output-directory');
  if (outputDirectory) {
    outputDirInput.value = outputDirectory;
    localStorage.setItem('outputDirectory', outputDirectory);
    outputLinkDiv.classList.remove('hidden');
    openOutputFolderLink.onclick = async () => {
      await ipcRenderer.invoke('open-folder', outputDirectory);
    };
  }
  updateProcessButton();
});

processButton.addEventListener('click', processFiles);

async function processFiles() {
  if (selectedFiles.length === 0) return;

  if (!userState.isPro) {
    checkDailyReset();
    if (userState.dailyCount >= 100) {
      showStatus(`You've reached your 100-file daily limit. Upgrade to Pro or wait until midnight for a limit reset.`, 'error');
      return;
    }
  }

  processButton.disabled = true;
  const oldButtonText = processButton.innerHTML;
  processButton.innerHTML = `<i class="fas fa-cog"></i> Anonymizing...`;

  progress.classList.remove('hidden');
  let total = selectedFiles.length;
  let processedCount = 0;

  for (let i = 0; i < total; i++) {
    if (!userState.isPro) {
      userState.dailyCount++;
      saveUserState();
      if (userState.dailyCount > 100) {
        showStatus(`You've reached your 100-file daily limit mid-batch.`, 'error');
        break;
      }
    }
    const file = selectedFiles[i];
    const result = await ipcRenderer.invoke('process-file', {
      filePath: file.path,
      outputDir: outputDirectory
    });
    if (!result.success) {
      showStatus(`Error processing ${file.name}: ${result.error}`, 'error');
    }
    processedCount++;
    let percentage = Math.floor((processedCount / total) * 100);
    progressBar.style.width = `${percentage}%`;
  }

  progressBar.style.width = '100%';
  showStatus(`Files processed successfully!`, 'success');

  processButton.disabled = false;
  processButton.innerHTML = oldButtonText;

  if (outputDirectory) {
    outputLinkDiv.classList.remove('hidden');
    openOutputFolderLink.onclick = async () => {
      await ipcRenderer.invoke('open-folder', outputDirectory);
    };
  }

  window.scrollTo(0, document.body.scrollHeight);
  clearState();

  setTimeout(() => {
    progress.classList.add('hidden');
    progressBar.style.width = '0%';
  }, 1500);
}

// Basic file logic
async function handleInputItems(fileList) {
  for (let i = 0; i < fileList.length; i++) {
    let fileItem = fileList[i];
    if (!fileItem.path) {
      fileItem = await createTempFile(fileItem);
      if (!fileItem) continue;
    }
    try {
      const stats = fs.lstatSync(fileItem.path);
      if (stats.isDirectory()) {
        const filesFromFolder = getFilesFromDirectory(fileItem.path);
        filesFromFolder.forEach((f) => addFile(f));
      } else {
        addFile({ path: fileItem.path, name: fileItem.name });
      }
    } catch (error) {
      console.error(error);
      showStatus(`Error processing ${fileItem.name}: ${error.message}`, 'error');
    }
  }
  updateFileListUI();
  updateProcessButton();
}

function createTempFile(fileItem) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const buffer = Buffer.from(reader.result);
      const tempDir = os.tmpdir();
      const tempPath = path.join(tempDir, fileItem.name);
      fs.writeFile(tempPath, buffer, (err) => {
        if (err) {
          showStatus(`Error writing temporary file: ${err.message}`, 'error');
          resolve(null);
        } else {
          resolve({ path: tempPath, name: fileItem.name });
        }
      });
    };
    reader.onerror = () => {
      showStatus(`Error reading file ${fileItem.name}`, 'error');
      resolve(null);
    };
    reader.readAsArrayBuffer(fileItem);
  });
}

function getFilesFromDirectory(dirPath) {
  let results = [];
  try {
    const list = fs.readdirSync(dirPath);
    list.forEach((file) => {
      const filePath = path.join(dirPath, file);
      const stat = fs.statSync(filePath);
      if (stat && stat.isDirectory()) {
        results = results.concat(getFilesFromDirectory(filePath));
      } else {
        const ext = path.extname(file).toLowerCase();
        if (['.doc','.docx','.xls','.xlsx','.csv','.pdf','.txt'].includes(ext)) {
          results.push({ path: filePath, name: file });
        }
      }
    });
  } catch (err) {
    console.error(`Error reading directory ${dirPath}: ${err.message}`);
  }
  return results;
}

function addFile(fileObj) {
  const ext = path.extname(fileObj.path).toLowerCase();
  if (['.doc','.docx','.xls','.xlsx','.csv','.pdf','.txt'].includes(ext)) {
    if (!selectedFiles.find((f) => f.path === fileObj.path)) {
      selectedFiles.push(fileObj);
    }
  } else {
    showStatus(`Unsupported file type: ${fileObj.name}`, 'error');
  }
}

function updateFileListUI() {
  filesUl.innerHTML = '';
  if (selectedFiles.length === 0) {
    fileListDiv.classList.add('hidden');
    return;
  }
  fileListDiv.classList.remove('hidden');
  selectedFiles.forEach(file => {
    const li = document.createElement('li');
    li.textContent = file.name;
    filesUl.appendChild(li);
  });
}

function updateProcessButton() {
  processButton.disabled = (selectedFiles.length === 0);
}

function clearState() {
  selectedFiles = [];
  fileInput.value = '';
  updateFileListUI();
  updateProcessButton();
}

// Show status in main area
function showStatus(message, type) {
  statusDiv.textContent = message;
  statusDiv.className = `status ${type}`;
  statusDiv.classList.remove('hidden');
}

// Logs from main -> renderer
ipcRenderer.on('log-message', (event, msg) => {
  logArea.classList.remove('hidden');
  logMessages.textContent = `Status: ${msg}`;
});



// PRO Upgrade UI & Logic
proButton.addEventListener('click', () => {
  if (userState.isPro) {
    showManageModal();
  } else {
    showUpgradeModal();
  }
});

proInfoLink.addEventListener('click', () => {
  if (userState.isPro) {
    showManageModal();
  } else {
    showInfoModal();
  }
});

// Upgrade modal
upgradeClose.addEventListener('click', hideUpgradeModal);
copyDeviceIdBtn.addEventListener('click', () => {
  deviceIdField.select();
  document.execCommand('copy');
  showStatus('Device ID copied to clipboard!', 'success');
});

// White wide button => open external store
upgradeStoreBtn.addEventListener('click', () => {
  require('electron').shell.openExternal('https://amicus5.com/store/PA');
});

// Validate key => show message in #key-message
validateKeyBtn.addEventListener('click', () => {
  const key = proKeyInput.value.trim();
  if (!key) {
    showKeyMessage('Please enter a key.', 'error');
    return;
  }
  if (validateProKey(key)) {
    userState.isPro = true;
    saveUserState();
    hideUpgradeModal();
    showStatus('Pro activated! Enjoy unlimited usage.', 'success');
    updateProUI();
  } else {
    showKeyMessage('Invalid key.', 'error');
  }
});

// Manage Plan modal
manageClose.addEventListener('click', hideManageModal);
downgradeBtn.addEventListener('click', () => {
  userState.isPro = false;
  saveUserState();
  hideManageModal();
  showStatus('You have been downgraded to free plan.', 'success');
  updateProUI();
});

// Info modal
infoClose.addEventListener('click', hideInfoModal);

// Simple validation
function validateProKey(key) {
  // e.g. "MASTERTESTKEY" or check simpleHash(userState.deviceID)
  // Return true if matches
  return (key === 'MASTERTESTKEY');
}

function showUpgradeModal() {
  deviceIdField.value = userState.deviceID;
  keyMessageDiv.classList.add('hidden'); // hide old messages
  upgradeModal.classList.add('show');
}
function hideUpgradeModal() {
  upgradeModal.classList.remove('show');
}
function showInfoModal() {
  infoModal.classList.add('show');
}
function hideInfoModal() {
  infoModal.classList.remove('show');
}
function showManageModal() {
  manageModal.classList.add('show');
}
function hideManageModal() {
  manageModal.classList.remove('show');
}

function showKeyMessage(msg, type) {
  keyMessageDiv.textContent = msg;
  keyMessageDiv.className = 'key-message'; // reset
  keyMessageDiv.classList.add(type === 'error' ? 'error' : 'success');
  keyMessageDiv.classList.remove('hidden');
}

function updateProUI() {
  if (userState.isPro) {
    proButton.textContent = 'Pro Version';
    proButton.classList.remove('pro-upgrade');
    proButton.classList.add('pro-active');
    proInfoLink.textContent = 'Manage Plan';
  } else {
    proButton.innerHTML = `<i class="fas fa-gem"></i> Upgrade to Pro`;
    proButton.classList.remove('pro-active');
    proButton.classList.add('pro-upgrade');
    proInfoLink.textContent = "What's Included in Pro?";
  }
}
