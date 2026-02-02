/**
 * Riistakamera Annotator - Frontend Logic
 * Canvas-pohjainen bounding box annotaatiotyökalu
 */

// Global state
let images = [];
let currentIndex = 0;
let annotations = [];
let currentBox = null;
let isDrawing = false;
let startX, startY;
let canvas, ctx;
let img = new Image();

// Initialize
document.addEventListener('DOMContentLoaded', init);

async function init() {
    canvas = document.getElementById('image-canvas');
    ctx = canvas.getContext('2d');
    
    // Event listeners
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    
    document.getElementById('save-btn').addEventListener('click', saveCurrentAnnotation);
    document.getElementById('next-btn').addEventListener('click', nextImage);
    document.getElementById('clear-current').addEventListener('click', clearCurrentBox);
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveCurrentAnnotation();
        if (e.key === 'n' || e.key === 'N') nextImage();
        if (e.key === 'c' || e.key === 'C') clearCurrentBox();
    });
    
    // Load images
    await loadImages();
}

async function loadImages() {
    try {
        const response = await fetch('/api/images');
        const data = await response.json();
        images = data.images;
        
        document.getElementById('loading').style.display = 'none';
        
        if (images.length === 0) {
            document.getElementById('no-images').style.display = 'block';
            return;
        }
        
        await loadImage(0);
    } catch (error) {
        console.error('Error loading images:', error);
        alert('Virhe kuvien lataamisessa: ' + error.message);
    }
}

async function loadImage(index) {
    if (index < 0 || index >= images.length) return;
    
    currentIndex = index;
    const imageName = images[currentIndex];
    
    // Load image
    img = new Image();
    img.onload = async () => {
        // Set canvas size to match image
        canvas.width = img.width;
        canvas.height = img.height;
        
        // Draw image
        drawCanvas();
        
        // Load existing annotations
        await loadAnnotations(imageName);
        
        // Update UI
        updateUI();
    };
    
    img.src = `/api/image/${imageName}`;
}

async function loadAnnotations(imageName) {
    try {
        const response = await fetch(`/api/annotation/${imageName}`);
        const data = await response.json();
        annotations = data.annotations || [];
        updateAnnotationsList();
    } catch (error) {
        console.error('Error loading annotations:', error);
        annotations = [];
    }
}

function drawCanvas() {
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw image
    ctx.drawImage(img, 0, 0);
    
    // Draw existing annotations
    ctx.strokeStyle = '#48bb78';
    ctx.lineWidth = 3;
    annotations.forEach((ann, idx) => {
        const [x1, y1, x2, y2] = ann.bbox;
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
        
        // Draw label
        ctx.fillStyle = '#48bb78';
        ctx.fillRect(x1, y1 - 25, 120, 25);
        ctx.fillStyle = 'white';
        ctx.font = '16px sans-serif';
        ctx.fillText(`${idx + 1}. ${ann.species}`, x1 + 5, y1 - 7);
    });
    
    // Draw current box
    if (currentBox) {
        ctx.strokeStyle = '#ed8936';
        ctx.lineWidth = 3;
        ctx.setLineDash([5, 5]);
        const [x1, y1, x2, y2] = currentBox;
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
        ctx.setLineDash([]);
    }
}

function handleMouseDown(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    startX = (e.clientX - rect.left) * scaleX;
    startY = (e.clientY - rect.top) * scaleY;
    
    isDrawing = true;
    currentBox = [startX, startY, startX, startY];
}

function handleMouseMove(e) {
    if (!isDrawing) return;
    
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const currentX = (e.clientX - rect.left) * scaleX;
    const currentY = (e.clientY - rect.top) * scaleY;
    
    currentBox = [startX, startY, currentX, currentY];
    drawCanvas();
}

function handleMouseUp(e) {
    if (!isDrawing) return;
    isDrawing = false;
    
    // Normalize box (ensure x1 < x2, y1 < y2)
    if (currentBox) {
        const [x1, y1, x2, y2] = currentBox;
        currentBox = [
            Math.min(x1, x2),
            Math.min(y1, y2),
            Math.max(x1, x2),
            Math.max(y1, y2)
        ];
        
        // Ignore tiny boxes (accidental clicks)
        const width = currentBox[2] - currentBox[0];
        const height = currentBox[3] - currentBox[1];
        if (width < 10 || height < 10) {
            currentBox = null;
        }
        
        drawCanvas();
    }
}

function saveCurrentAnnotation() {
    if (!currentBox) {
        alert('Piirrä ensin laatikko eläimen ympärille!');
        return;
    }
    
    const species = document.getElementById('species-select').value;
    if (!species) {
        alert('Valitse eläinlaji!');
        return;
    }
    
    // Add annotation
    annotations.push({
        bbox: currentBox,
        species: species
    });
    
    // Clear current box
    currentBox = null;
    document.getElementById('species-select').value = '';
    
    // Redraw and update
    drawCanvas();
    updateAnnotationsList();
    
    // Save to backend
    saveAnnotationsToBackend();
}

function clearCurrentBox() {
    currentBox = null;
    drawCanvas();
}

function deleteAnnotation(index) {
    annotations.splice(index, 1);
    drawCanvas();
    updateAnnotationsList();
    saveAnnotationsToBackend();
}

function updateAnnotationsList() {
    const ul = document.getElementById('annotations-ul');
    ul.innerHTML = '';
    
    if (annotations.length === 0) {
        ul.innerHTML = '<li style="border: none; color: #999;">Ei annotaatioita</li>';
        document.getElementById('annotation-count').textContent = '0 annotaatiota';
        return;
    }
    
    annotations.forEach((ann, idx) => {
        const li = document.createElement('li');
        const [x1, y1, x2, y2] = ann.bbox;
        const width = Math.round(x2 - x1);
        const height = Math.round(y2 - y1);
        
        li.innerHTML = `
            <span>${idx + 1}. <strong>${ann.species}</strong> (${width}×${height}px)</span>
            <button class="delete-btn" onclick="deleteAnnotation(${idx})">🗑️ Poista</button>
        `;
        ul.appendChild(li);
    });
    
    document.getElementById('annotation-count').textContent = `${annotations.length} annotaatiota`;
}

async function saveAnnotationsToBackend() {
    const imageName = images[currentIndex];
    const data = {
        image_name: imageName,
        annotations: annotations
    };
    
    try {
        const response = await fetch(`/api/annotation/${imageName}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });
        
        const result = await response.json();
        if (result.success) {
            console.log('✅ Saved:', result.saved_to);
        }
    } catch (error) {
        console.error('Error saving annotations:', error);
        alert('Virhe tallennuksessa: ' + error.message);
    }
}

async function nextImage() {
    if (currentIndex < images.length - 1) {
        // Save current before moving
        if (annotations.length > 0) {
            await saveAnnotationsToBackend();
        }
        
        currentBox = null;
        await loadImage(currentIndex + 1);
    } else {
        alert('Viimeinen kuva! 🎉');
    }
}

function updateUI() {
    document.getElementById('image-counter').textContent = 
        `${currentIndex + 1} / ${images.length}`;
}

// Make deleteAnnotation global
window.deleteAnnotation = deleteAnnotation;
