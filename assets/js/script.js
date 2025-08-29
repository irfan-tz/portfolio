// Vertex shader for trail lines
        const vertexShaderSource = `
            attribute vec2 a_position;
            attribute vec4 a_color;
            attribute float a_lineWidth;
            
            uniform vec2 u_resolution;
            uniform mat3 u_transform;
            
            varying vec4 v_color;
            
            void main() {
                vec3 pos = u_transform * vec3(a_position, 1.0);
                vec2 clipSpace = ((pos.xy / u_resolution) * 2.0 - 1.0) * vec2(1, -1);
                gl_Position = vec4(clipSpace, 0, 1);
                v_color = a_color;
                gl_PointSize = a_lineWidth;
            }
        `;

        // Fragment shader for glowing effect
        const fragmentShaderSource = `
            precision mediump float;
            
            varying vec4 v_color;
            
            void main() {
                vec2 center = gl_PointCoord - vec2(0.5);
                float dist = length(center);
                float alpha = v_color.a * (1.0 - smoothstep(0.0, 0.5, dist));
                gl_FragColor = vec4(v_color.rgb, alpha);
            }
        `;

        // Line vertex shader
        const lineVertexShaderSource = `
            attribute vec2 a_position;
            attribute vec4 a_color;
            
            uniform vec2 u_resolution;
            
            varying vec4 v_color;
            
            void main() {
                vec2 clipSpace = ((a_position / u_resolution) * 2.0 - 1.0) * vec2(1, -1);
                gl_Position = vec4(clipSpace, 0, 1);
                v_color = a_color;
            }
        `;

        // Line fragment shader
        const lineFragmentShaderSource = `
            precision mediump float;
            
            varying vec4 v_color;
            
            void main() {
                gl_FragColor = v_color;
            }
        `;

        class NeonFlowWebGL {
            constructor() {
                this.canvas = document.getElementById('neonCanvas');
                this.gl = this.canvas.getContext('webgl', {
                    alpha: false,
                    antialias: true,
                    preserveDrawingBuffer: false,
                    powerPreference: 'high-performance'
                });

                if (!this.gl) {
                    console.error('WebGL not supported');
                    return;
                }

                this.time = 0;
                this.points = [];
                this.isAndroid = /Android/i.test(navigator.userAgent);
                this.isMobile = /Mobi|Android/i.test(navigator.userAgent);
                this.numPoints = this.isAndroid ? 100 : (this.isMobile ? 120 : 150);
                this.maxTrailLength = 30;
                this.targetFPS = 40;
                this.frameInterval = 1000 / this.targetFPS;
                this.lastFrameTime = 0;
                this.fieldSize = 20;
                this.flowUpdateFreq = 5;
                this.flowUpdateCounter = 0;

                // WebGL setup
                this.setupWebGL();
                this.resize();
                this.initPoints();
                this.initSimpleFlow();
                this.animate();

                window.addEventListener('resize', () => this.resize());
            }

            setupWebGL() {
                const gl = this.gl;

                // Create shaders
                this.lineProgram = this.createProgram(lineVertexShaderSource, lineFragmentShaderSource);
                this.pointProgram = this.createProgram(vertexShaderSource, fragmentShaderSource);

                // Get locations
                this.lineLocations = {
                    position: gl.getAttribLocation(this.lineProgram, 'a_position'),
                    color: gl.getAttribLocation(this.lineProgram, 'a_color'),
                    resolution: gl.getUniformLocation(this.lineProgram, 'u_resolution')
                };

                this.pointLocations = {
                    position: gl.getAttribLocation(this.pointProgram, 'a_position'),
                    color: gl.getAttribLocation(this.pointProgram, 'a_color'),
                    lineWidth: gl.getAttribLocation(this.pointProgram, 'a_lineWidth'),
                    resolution: gl.getUniformLocation(this.pointProgram, 'u_resolution'),
                    transform: gl.getUniformLocation(this.pointProgram, 'u_transform')
                };

                // Create buffers
                this.linePositionBuffer = gl.createBuffer();
                this.lineColorBuffer = gl.createBuffer();
                this.pointPositionBuffer = gl.createBuffer();
                this.pointColorBuffer = gl.createBuffer();
                this.pointSizeBuffer = gl.createBuffer();

                // Setup WebGL state
                gl.enable(gl.BLEND);
                gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // Additive blending for glow effect
                gl.clearColor(0.0, 0.0, 0.0, 1.0);

                // Create fade texture for trail effect
                this.createFadeFramebuffer();
            }

            createFadeFramebuffer() {
                const gl = this.gl;
                this.fadeFramebuffer = gl.createFramebuffer();
                this.fadeTexture = gl.createTexture();

                gl.bindTexture(gl.TEXTURE_2D, this.fadeTexture);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            }

            createShader(source, type) {
                const gl = this.gl;
                const shader = gl.createShader(type);
                gl.shaderSource(shader, source);
                gl.compileShader(shader);

                if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                    console.error('Shader compile error:', gl.getShaderInfoLog(shader));
                    gl.deleteShader(shader);
                    return null;
                }

                return shader;
            }

            createProgram(vertexSource, fragmentSource) {
                const gl = this.gl;
                const vertexShader = this.createShader(vertexSource, gl.VERTEX_SHADER);
                const fragmentShader = this.createShader(fragmentSource, gl.FRAGMENT_SHADER);

                const program = gl.createProgram();
                gl.attachShader(program, vertexShader);
                gl.attachShader(program, fragmentShader);
                gl.linkProgram(program);

                if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
                    console.error('Program link error:', gl.getProgramInfoLog(program));
                    return null;
                }

                return program;
            }

            resize() {
                this.canvas.width = window.innerWidth;
                this.canvas.height = window.innerHeight;
                this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);

                this.fieldCols = Math.ceil(this.canvas.width / this.fieldSize);
                this.fieldRows = Math.ceil(this.canvas.height / this.fieldSize);
                this.initSimpleFlow();

                // Update fade texture size
                const gl = this.gl;
                gl.bindTexture(gl.TEXTURE_2D, this.fadeTexture);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.canvas.width, this.canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            }

            initPoints() {
                this.points = [];
                for (let i = 0; i < this.numPoints; i++) {
                    this.points.push({
                        x: Math.random() * this.canvas.width,
                        y: Math.random() * this.canvas.height,
                        vx: 0,
                        vy: 0,
                        life: Math.random() * 50,
                        maxLife: this.isAndroid ? 100 : 150,
                        trail: []
                    });
                }
            }

            initSimpleFlow() {
                this.flowField = [];
                for (let y = 0; y < this.fieldRows; y++) {
                    this.flowField[y] = [];
                    for (let x = 0; x < this.fieldCols; x++) {
                        this.flowField[y][x] = { x: 0, y: 0 };
                    }
                }
            }

            updateSimpleFlow() {
                if (this.flowUpdateCounter++ % this.flowUpdateFreq !== 0) return;

                const scale = 0.02;
                const timeScale = this.time * 0.01;

                for (let y = 0; y < this.fieldRows; y++) {
                    for (let x = 0; x < this.fieldCols; x++) {
                        const angle1 = (x * scale + timeScale) * Math.PI;
                        const angle2 = (y * scale + timeScale * 0.7) * Math.PI;
                        this.flowField[y][x] = {
                            x: Math.sin(angle1) * Math.cos(angle2),
                            y: Math.cos(angle1) * Math.sin(angle2)
                        };
                    }
                }
            }

            updatePoints() {
                this.points.forEach(point => {
                    const fieldX = Math.floor(point.x / this.fieldSize);
                    const fieldY = Math.floor(point.y / this.fieldSize);

                    if (fieldY >= 0 && fieldY < this.fieldRows && fieldX >= 0 && fieldX < this.fieldCols) {
                        const field = this.flowField[fieldY][fieldX];
                        const strength = 0.2;
                        point.vx += field.x * strength;
                        point.vy += field.y * strength;
                    }

                    const damping = this.isAndroid ? 0.92 : 0.95;
                    point.vx *= damping;
                    point.vy *= damping;

                    point.x += point.vx;
                    point.y += point.vy;

                    point.trail.push({ x: point.x, y: point.y });
                    if (point.trail.length > this.maxTrailLength) {
                        point.trail.shift();
                    }

                    point.life++;

                    if (point.x < -50 || point.x > this.canvas.width + 50 ||
                        point.y < -50 || point.y > this.canvas.height + 50 ||
                        point.life > point.maxLife) {
                        point.x = Math.random() * this.canvas.width;
                        point.y = Math.random() * this.canvas.height;
                        point.vx = (Math.random() - 0.5) * 2;
                        point.vy = (Math.random() - 0.5) * 2;
                        point.life = 0;
                        point.trail = [];
                    }
                });
            }

            hslToRgb(h, s, l) {
                h /= 360;
                s /= 100;
                l /= 100;

                const hue2rgb = (p, q, t) => {
                    if (t < 0) t += 1;
                    if (t > 1) t -= 1;
                    if (t < 1 / 6) return p + (q - p) * 6 * t;
                    if (t < 1 / 2) return q;
                    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
                    return p;
                };

                let r, g, b;
                if (s === 0) {
                    r = g = b = l;
                } else {
                    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
                    const p = 2 * l - q;
                    r = hue2rgb(p, q, h + 1 / 3);
                    g = hue2rgb(p, q, h);
                    b = hue2rgb(p, q, h - 1 / 3);
                }

                return [r, g, b];
            }

            draw() {
                const gl = this.gl;

                // Clear with fade effect
                const fadeAlpha = this.isAndroid ? 0.03 : 0.05;
                gl.clearColor(0, 0, 0, fadeAlpha);
                gl.clear(gl.COLOR_BUFFER_BIT);

                if (this.isAndroid) {
                    this.drawComplex();
                } else {
                    this.drawComplex();
                }
            }

            drawSimple() {
                const gl = this.gl;
                gl.useProgram(this.lineProgram);
                gl.uniform2f(this.lineLocations.resolution, this.canvas.width, this.canvas.height);

                // Prepare line data
                const positions = [];
                const colors = [];

                this.points.forEach(point => {
                    if (point.trail.length > 1) {
                        for (let i = 0; i < point.trail.length - 1; i++) {
                            const alpha = (i / point.trail.length) * 0.6;
                            const hue = (this.time * 0.5 + point.x * 0.01) % 360;
                            const [r, g, b] = this.hslToRgb(hue, 70, 60);

                            // Line segment
                            positions.push(point.trail[i].x, point.trail[i].y);
                            positions.push(point.trail[i + 1].x, point.trail[i + 1].y);

                            colors.push(r, g, b, alpha);
                            colors.push(r, g, b, alpha);
                        }
                    }
                });

                if (positions.length > 0) {
                    // Upload position data
                    gl.bindBuffer(gl.ARRAY_BUFFER, this.linePositionBuffer);
                    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.DYNAMIC_DRAW);
                    gl.enableVertexAttribArray(this.lineLocations.position);
                    gl.vertexAttribPointer(this.lineLocations.position, 2, gl.FLOAT, false, 0, 0);

                    // Upload color data
                    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineColorBuffer);
                    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colors), gl.DYNAMIC_DRAW);
                    gl.enableVertexAttribArray(this.lineLocations.color);
                    gl.vertexAttribPointer(this.lineLocations.color, 4, gl.FLOAT, false, 0, 0);

                    gl.drawArrays(gl.LINES, 0, positions.length / 2);
                }
            }

            drawComplex() {
                const gl = this.gl;
                gl.useProgram(this.pointProgram);
                gl.uniform2f(this.pointLocations.resolution, this.canvas.width, this.canvas.height);
                gl.uniformMatrix3fv(this.pointLocations.transform, false, [1, 0, 0, 0, 1, 0, 0, 0, 1]);

                const positions = [];
                const colors = [];
                const sizes = [];

                this.points.forEach(point => {
                    if (point.trail.length > 1) {
                        const alpha = Math.max(0, 1 - point.life / point.maxLife);
                        const hue = (this.time * 0.5 + point.x * 0.01) % 360;

                        for (let i = 0; i < point.trail.length; i++) {
                            const trailAlpha = (i / point.trail.length) * alpha * 0.8;
                            const [r, g, b] = this.hslToRgb((hue + i * 2) % 360, 90, 70);

                            const x = point.trail[i].x;
                            const y = point.trail[i].y;

                            // ✨ Core point (sharp)
                            positions.push(x, y);
                            colors.push(r, g, b, trailAlpha);
                            sizes.push(3.0);

                            // ✨ Mid glow
                            positions.push(x, y);
                            colors.push(r, g, b, trailAlpha * 0.5);
                            sizes.push(8.0);

                            // ✨ Outer glow
                            positions.push(x, y);
                            colors.push(r, g, b, trailAlpha * 0.2);
                            sizes.push(16.0);
                        }
                    }
                });

                if (positions.length > 0) {
                    // Upload position data
                    gl.bindBuffer(gl.ARRAY_BUFFER, this.pointPositionBuffer);
                    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.DYNAMIC_DRAW);
                    gl.enableVertexAttribArray(this.pointLocations.position);
                    gl.vertexAttribPointer(this.pointLocations.position, 2, gl.FLOAT, false, 0, 0);

                    // Upload color data
                    gl.bindBuffer(gl.ARRAY_BUFFER, this.pointColorBuffer);
                    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colors), gl.DYNAMIC_DRAW);
                    gl.enableVertexAttribArray(this.pointLocations.color);
                    gl.vertexAttribPointer(this.pointLocations.color, 4, gl.FLOAT, false, 0, 0);

                    // Upload size data
                    gl.bindBuffer(gl.ARRAY_BUFFER, this.pointSizeBuffer);
                    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(sizes), gl.DYNAMIC_DRAW);
                    gl.enableVertexAttribArray(this.pointLocations.lineWidth);
                    gl.vertexAttribPointer(this.pointLocations.lineWidth, 1, gl.FLOAT, false, 0, 0);

                    gl.drawArrays(gl.POINTS, 0, positions.length / 2);
                }
            }


            animate(currentTime = 0) {
                if (currentTime - this.lastFrameTime < this.frameInterval) {
                    requestAnimationFrame((time) => this.animate(time));
                    return;
                }

                this.lastFrameTime = currentTime;
                this.time++;
                this.updateSimpleFlow();
                this.updatePoints();
                this.draw();

                requestAnimationFrame((time) => this.animate(time));
            }
        }

        // Initialize when page loads
        window.addEventListener('load', () => {
            new NeonFlowWebGL();
        });

document.addEventListener('DOMContentLoaded', () => {
    const clickableTitles = document.querySelectorAll('.has-images .project-title, .has-images .experience-title');

    clickableTitles.forEach(title => {
        title.addEventListener('click', () => {
            const item = title.closest('.has-images');
            const imageContainer = item.querySelector('.project-image-container');
            const icon = title.querySelector('.accordion-icon');

            if (imageContainer) {
                const isVisible = imageContainer.classList.contains('visible');

                // Close all other items
                document.querySelectorAll('.project-image-container.visible').forEach(container => {
                    if (container !== imageContainer) {
                        container.classList.remove('visible');
                        const otherItem = container.closest('.has-images');
                        otherItem.querySelector('.accordion-icon').classList.remove('open');
                        otherItem.querySelector('.project-title, .experience-title').classList.remove('active-project-title');
                    }
                });

                // Toggle the clicked item
                imageContainer.classList.toggle('visible');
                icon.classList.toggle('open');
                title.classList.toggle('active-project-title');
            }
        });
    });
});

// Lightbox
let currentImageIndex;
let currentGallery;

function openLightbox(element) {
    const lightbox = document.getElementById('myLightbox');
    const lightboxImg = document.getElementById('lightboxImg');
    lightbox.style.display = "block";
    lightboxImg.src = element.src;

    const galleryName = element.getAttribute('data-gallery');
    if (galleryName) {
        currentGallery = document.querySelectorAll(`[data-gallery='${galleryName}']`);
        currentImageIndex = parseInt(element.getAttribute('data-index'));
        document.querySelector('.prev-lightbox').style.display = 'block';
        document.querySelector('.next-lightbox').style.display = 'block';
    } else {
        currentGallery = null;
        document.querySelector('.prev-lightbox').style.display = 'none';
        document.querySelector('.next-lightbox').style.display = 'none';
    }
}

function closeLightbox() {
    document.getElementById('myLightbox').style.display = "none";
}

function changeSlide(n) {
    currentImageIndex += n;
    if (currentImageIndex >= currentGallery.length) {
        currentImageIndex = 0;
    }
    if (currentImageIndex < 0) {
        currentImageIndex = currentGallery.length - 1;
    }
    document.getElementById('lightboxImg').src = currentGallery[currentImageIndex].src;
}

