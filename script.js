// DOM Elements
const viewSetup = document.getElementById('view-setup');
const viewRecording = document.getElementById('view-recording');
const viewProcessing = document.getElementById('view-processing');
const viewPreview = document.getElementById('view-preview');

const btnScreen = document.getElementById('btn-screen');
const btnCamera = document.getElementById('btn-camera');
const btnSwap = document.getElementById('btn-swap');
const btnStartRecord = document.getElementById('btn-start-record');
const btnStopRecord = document.getElementById('btn-stop-record');
const btnProcess = document.getElementById('btn-process');
const btnDownload = document.getElementById('btn-download');
const btnRestart = document.getElementById('btn-restart');

const layoutControls = document.getElementById('layout-controls');
const selectSize = document.getElementById('select-size');
const selectPosition = document.getElementById('select-position');
const speedSlider = document.getElementById('speed-slider');
const speedLabel = document.getElementById('speed-label');
const processingStatus = document.getElementById('processing-status');

const hiddenScreen = document.getElementById('hidden-screen');
const hiddenCamera = document.getElementById('hidden-camera');
const hiddenPlayback = document.getElementById('hidden-playback');
const liveCanvas = document.getElementById('live-canvas');
const processCanvas = document.getElementById('process-canvas');
const previewVideo = document.getElementById('preview-video');

const liveCtx = liveCanvas.getContext('2d');
const processCtx = processCanvas.getContext('2d');

// State variables
let screenStream = null;
let cameraStream = null;
let animationFrameId = null;
let mediaRecorder = null;
let recordedChunks = [];
let normalSpeedBlob = null;
let finalBlob = null;
let recordingStartTime = null;

let isScreenMain = true; // True: Screen is full, Cam is circle. False: inverted.

// Helper to switch views
function showView(viewElement) {
    [viewSetup, viewRecording, viewProcessing, viewPreview].forEach(v => v.classList.add('hidden'));
    viewElement.classList.remove('hidden');
}

// Check if layout controls should be shown
function checkReadyStatus() {
    if (screenStream && cameraStream) {
        layoutControls.classList.remove('hidden');
        startCompositingLoop(liveCtx);
    }
}

// Media Stream Requests
btnScreen.addEventListener('click', async () => {
    try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { width: 1920, height: 1080 }, audio: false });
        hiddenScreen.srcObject = screenStream;
        btnScreen.style.background = "#4CAF50"; // Green to indicate success
        btnScreen.innerText = "Screen Connected";
        checkReadyStatus();
    } catch (err) {
        console.error("Error accessing screen:", err);
    }
});

btnCamera.addEventListener('click', async () => {
    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false });
        hiddenCamera.srcObject = cameraStream;
        btnCamera.style.background = "#4CAF50";
        btnCamera.innerText = "Camera Connected";
        checkReadyStatus();
    } catch (err) {
        console.error("Error accessing camera:", err);
    }
});

// Layout Adjustments
btnSwap.addEventListener('click', () => {
    isScreenMain = !isScreenMain;
});

// Compositing Loop
function startCompositingLoop(ctx) {
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    
    function draw() {
        ctx.clearRect(0, 0, 1920, 1080);
        
        let mainVideo = isScreenMain ? hiddenScreen : hiddenCamera;
        let pipVideo = isScreenMain ? hiddenCamera : hiddenScreen;

        // Draw Main Fullscreen
        if (mainVideo.readyState === mainVideo.HAVE_ENOUGH_DATA) {
            ctx.drawImage(mainVideo, 0, 0, 1920, 1080);
        }

        // Draw PIP
        if (pipVideo.readyState === pipVideo.HAVE_ENOUGH_DATA) {
            let radius = selectSize.value === 'small' ? 120 : (selectSize.value === 'medium' ? 180 : 250);
            let padding = 40;
            let cx, cy;
            
            let pos = selectPosition.value;
            if (pos === 'bottom-left') { cx = radius + padding; cy = 1080 - radius - padding; }
            else if (pos === 'bottom-right') { cx = 1920 - radius - padding; cy = 1080 - radius - padding; }
            else if (pos === 'top-left') { cx = radius + padding; cy = radius + padding; }
            else if (pos === 'top-right') { cx = 1920 - radius - padding; cy = radius + padding; }

            ctx.save();
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx.closePath();
            ctx.clip();
            
            // Draw video centered in circle, maintaining aspect ratio
            let aspect = pipVideo.videoWidth / pipVideo.videoHeight;
            let drawWidth = radius * 2;
            let drawHeight = drawWidth / aspect;
            
            if (drawHeight < radius * 2) {
                drawHeight = radius * 2;
                drawWidth = drawHeight * aspect;
            }
            
            ctx.drawImage(pipVideo, cx - drawWidth / 2, cy - drawHeight / 2, drawWidth, drawHeight);
            
            // Draw glass border
            ctx.strokeStyle = "rgba(255,255,255,0.8)";
            ctx.lineWidth = 8;
            ctx.stroke();
            
            ctx.restore();
        }

        animationFrameId = requestAnimationFrame(draw);
    }
    draw();
}

// Recording Logic
btnStartRecord.addEventListener('click', () => {
    showView(viewRecording);
    recordedChunks = [];
    recordingStartTime = new Date();
    
    const stream = liveCanvas.captureStream(30); // Capture at 30fps
    
    // Check supported types
    let mimeType = 'video/webm;codecs=vp9';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm;codecs=vp8';
    }
    
    mediaRecorder = new MediaRecorder(stream, { mimeType: mimeType });
    
    mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunks.push(e.data);
    };
    
    mediaRecorder.onstop = () => {
        normalSpeedBlob = new Blob(recordedChunks, { type: mimeType });
        showView(viewProcessing);
    };
    
    mediaRecorder.start();
});

btnStopRecord.addEventListener('click', () => {
    mediaRecorder.stop();
    if (screenStream) screenStream.getTracks().forEach(t => t.stop());
    if (cameraStream) cameraStream.getTracks().forEach(t => t.stop());
    cancelAnimationFrame(animationFrameId);
});

// Speed slider update
speedSlider.addEventListener('input', (e) => {
    speedLabel.innerText = e.target.value + '%';
});

// Post-Processing Logic (Re-recording for Timelapse)
btnProcess.addEventListener('click', async () => {
    btnProcess.classList.add('hidden');
    processingStatus.classList.remove('hidden');

    let speedMultiplier = parseInt(speedSlider.value) / 100;
    
    if (speedMultiplier === 1.0) {
        // No speed change needed
        finalBlob = normalSpeedBlob;
        finishProcessing();
        return;
    }

    // Re-recording trick for completely native browser timelapse handling
    hiddenPlayback.src = URL.createObjectURL(normalSpeedBlob);
    hiddenPlayback.playbackRate = speedMultiplier;
    hiddenPlayback.muted = true;
    
    await hiddenPlayback.play();
    
    const outStream = processCanvas.captureStream(30);
    let mimeType = normalSpeedBlob.type;
    const processRecorder = new MediaRecorder(outStream, { mimeType: mimeType });
    let processChunks = [];
    
    processRecorder.ondataavailable = (e) => processChunks.push(e.data);
    processRecorder.onstop = () => {
        finalBlob = new Blob(processChunks, { type: mimeType });
        finishProcessing();
    };
    
    processRecorder.start();

    // Draw loop for processing
    function processDraw() {
        if (hiddenPlayback.paused || hiddenPlayback.ended) return;
        processCtx.drawImage(hiddenPlayback, 0, 0, 1920, 1080);
        requestAnimationFrame(processDraw);
    }
    processDraw();

    hiddenPlayback.onended = () => {
        processRecorder.stop();
    };
});

function finishProcessing() {
    processingStatus.classList.add('hidden');
    btnProcess.classList.remove('hidden');
    
    const finalUrl = URL.createObjectURL(finalBlob);
    previewVideo.src = finalUrl;
    showView(viewPreview);
}

// Download Logic
btnDownload.addEventListener('click', () => {
    // Format Date: KukScreen-(date)@(start_time).mp4 / .webm
    let dateStr = recordingStartTime.toISOString().split('T')[0];
    let timeRaw = recordingStartTime.toTimeString().split(' ')[0]; // HH:MM:SS
    let timeStr = timeRaw.replace(/:/g, '-');
    
    // Browsers natively output WebM. We label it dynamically based on MIME
    let ext = finalBlob.type.includes('mp4') ? 'mp4' : 'webm';
    let filename = `KukScreen-${dateStr}@${timeStr}.${ext}`;

    const a = document.createElement('a');
    a.href = URL.createObjectURL(finalBlob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
});

// Restart Logic
btnRestart.addEventListener('click', () => {
    location.reload(); // Quickest way to reset stream bindings and states
});
