/**
 * Viewer class
 * @param options (Object) Viewer settings
 */
function PhotoSphereViewer(options) {
  if (!(this instanceof PhotoSphereViewer)) {
    return new PhotoSphereViewer(options);
  }

  if (options === undefined || options.panorama === undefined || options.container === undefined) {
    throw new PSVError('no value given for panorama or container');
  }

  this.config = PSVUtils.deepmerge(PhotoSphereViewer.DEFAULTS, options);

  // normalize config
  this.config.min_fov = PSVUtils.stayBetween(this.config.min_fov, 1, 179);
  this.config.max_fov = PSVUtils.stayBetween(this.config.max_fov, 1, 179);
  this.config.tilt_up_max = PSVUtils.stayBetween(this.config.tilt_up_max, -PhotoSphereViewer.HalfPI, PhotoSphereViewer.HalfPI);
  this.config.tilt_down_max = PSVUtils.stayBetween(this.config.tilt_down_max, -PhotoSphereViewer.HalfPI, PhotoSphereViewer.HalfPI);
  if (this.config.default_fov === null) {
    this.config.default_fov = this.config.max_fov;
  }
  else {
    this.config.default_fov = PSVUtils.stayBetween(this.config.default_fov, this.config.min_fov, this.config.max_fov);
  }
  if (this.config.anim_lat === null) {
    this.config.anim_lat = this.config.default_lat;
  }
  this.config.anim_lat = PSVUtils.stayBetween(this.config.anim_lat, -PhotoSphereViewer.HalfPI, PhotoSphereViewer.HalfPI);
  
  if (this.config.tilt_up_max < this.config.tilt_down_max) {
    throw new PSVError('tilt_up_max cannot be lower than tilt_down_max');
  }

  // references to components
  this.container = (typeof this.config.container == 'string') ? document.getElementById(this.config.container) : this.config.container;
  this.loader = null;
  this.navbar = null;
  this.hud = null;
  this.panel = null;
  this.tooltip = null;
  this.canvas_container = null;
  this.renderer = null;
  this.scene = null;
  this.camera = null;
  this.raycaster = null;
  this.actions = {};

  // local properties
  this.prop = {
    fps: 60,
    latitude: 0,
    longitude: 0,
    anim_speed: 0,
    zoom_lvl: 0,
    moving: false,
    zooming: false,
    start_mouse_x: 0,
    start_mouse_y: 0,
    mouse_x: 0,
    mouse_y: 0,
    pinch_dist: 0,
    direction: null,
    autorotate_timeout: null,
    animation_timeout: null,
    start_timeout: null,
    size: {
      width: 0,
      height: 0,
      ratio: 0,
      image_width: 0,
      image_height: 0
    }
  };

  // compute zoom level
  this.prop.zoom_lvl = Math.round((this.config.default_fov - this.config.min_fov) / (this.config.max_fov - this.config.min_fov) * 100);
  this.prop.zoom_lvl-= 2 * (this.prop.zoom_lvl - 50);

  // init
  this.setAnimSpeed(this.config.anim_speed);

  this.rotate(this.config.default_long, this.config.default_lat);

  if (this.config.size !== null) {
    this.container.style.width = this.config.size.width;
    this.container.style.height = this.config.size.height;
  }

  if (this.config.autoload) {
    this.load();
  }
}

PhotoSphereViewer.PI = Math.PI;
PhotoSphereViewer.TwoPI = Math.PI * 2.0;
PhotoSphereViewer.HalfPI = Math.PI / 2.0;

PhotoSphereViewer.MOVE_THRESHOLD = 4;

PhotoSphereViewer.ICONS = {};

/**
 * PhotoSphereViewer defaults
 */
PhotoSphereViewer.DEFAULTS = {
  panorama: null,
  container: null,
  caption: null,
  autoload: true,
  usexmpdata: true,
  min_fov: 30,
  max_fov: 90,
  default_fov: null,
  default_long: 0,
  default_lat: 0,
  tilt_up_max: PhotoSphereViewer.HalfPI,
  tilt_down_max: -PhotoSphereViewer.HalfPI,
  long_offset: Math.PI / 1440.0,
  lat_offset: Math.PI / 720.0,
  time_anim: 2000,
  anim_speed: '2rpm',
  anim_lat: null,
  navbar: false,
  tooltip: {
    offset: 5,
    arrow_size: 7
  },
  lang: {
    autorotate: 'Automatic rotation',
    zoom: 'Zoom',
    zoomOut: 'Zoom out',
    zoomIn: 'Zoom in',
    download: 'Download',
    fullscreen: 'Fullscreen',
    markers: 'Markers'
  },
  mousewheel: true,
  mousemove: true,
  loading_img: null,
  loading_txt: 'Loading...',
  size: null,
  markers: []
};

/**
 * Starts to load the panorama
 * @return (void)
 */
PhotoSphereViewer.prototype.load = function() {
  this.container.classList.add('psv-container', 'loading');

  // Is canvas supported?
  if (!PSVUtils.isCanvasSupported()) {
    this.container.textContent = 'Canvas is not supported, update your browser!';
    return;
  }

  // Loader
  this.loader = new PSVLoader(this);

  // Canvas container
  this.canvas_container = document.createElement('div');
  this.canvas_container.className = 'psv-canvas-container';
  this.container.appendChild(this.canvas_container);

  // load image
  if (this.config.usexmpdata) {
    this._loadXMP();
  }
  else {
    this._loadTexture(false, false);
  }
};

/**
 * Loads the XMP data with AJAX
 * @return (void)
 */
PhotoSphereViewer.prototype._loadXMP = function() {
  if (!window.XMLHttpRequest) {
    this.container.textContent = 'XHR is not supported, update your browser!';
    return;
  }

  var xhr = new XMLHttpRequest();
  var self = this;
  var progress = 0;

  xhr.onreadystatechange = function() {
    if (xhr.readyState === 4) {
      if (xhr.status === 200 || xhr.status === 201 || xhr.status === 202 || xhr.status === 0) {
        self.loader.setProgress(100);

        var binary = xhr.responseText;
        var a = binary.indexOf('<x:xmpmeta'), b = binary.indexOf('</x:xmpmeta>');
        var data = binary.substring(a, b);

        // No data retrieved
        if (a === -1 || b === -1 || data.indexOf('GPano:') === -1) {
          self._loadTexture(false, true);
          return;
        }

        var pano_data = {
          full_width: parseInt(PSVUtils.getAttribute(data, 'FullPanoWidthPixels')),
          full_height: parseInt(PSVUtils.getAttribute(data, 'FullPanoHeightPixels')),
          cropped_width: parseInt(PSVUtils.getAttribute(data, 'CroppedAreaImageWidthPixels')),
          cropped_height: parseInt(PSVUtils.getAttribute(data, 'CroppedAreaImageHeightPixels')),
          cropped_x: parseInt(PSVUtils.getAttribute(data, 'CroppedAreaLeftPixels')),
          cropped_y: parseInt(PSVUtils.getAttribute(data, 'CroppedAreaTopPixels')),
        };

        self._loadTexture(pano_data, true);
      }
      else {
        self.container.textContent = 'Cannot load image';
      }
    }
    else if (xhr.readyState === 3) {
      self.loader.setProgress(progress + 10);
    }
  };

  xhr.onprogress = function(e) {
    if (e.lengthComputable) {
      var new_progress = parseInt(e.loaded / e.total * 100);
      if (new_progress > progress) {
        progress = new_progress;
        self.loader.setProgress(progress);
      }
    }
  };

  xhr.onerror = function() {
    self.container.textContent = 'Cannot load image';
  };

  xhr.open('GET', this.config.panorama, true);
  xhr.send(null);
};

/**
 * Loads the sphere texture
 * @param pano_data (mixed) An object containing the panorama XMP data (false if it there is not)
 * @param in_cache (boolean) If the image has already been loaded and should be in cache
 * @return (void)
 */
PhotoSphereViewer.prototype._loadTexture = function(pano_data, in_cache) {
  var loader = new THREE.ImageLoader();
  var self = this;
  var progress = in_cache ? 100 : 0;

  // CORS when the panorama is not given as a base64 string
  if (!this.config.panorama.match(/^data:image\/[a-z]+;base64/)) {
    loader.setCrossOrigin('anonymous');
  }

  var onload = function(img) {
    self.loader.setProgress(100);

    // Default XMP data
    if (!pano_data) {
      pano_data = {
        full_width: img.width,
        full_height: img.height,
        cropped_width: img.width,
        cropped_height: img.height,
        cropped_x: 0,
        cropped_y: 0,
      };
    }

    // Size limit for mobile compatibility
    var max_width = 4096;
    if (PSVUtils.isWebGLSupported()) {
      max_width = PSVUtils.getMaxTextureWidth();
    }

    var new_width = Math.min(pano_data.full_width, max_width);
    var r = new_width / pano_data.full_width;

    pano_data.full_width *= r;
    pano_data.full_height *= r;
    pano_data.cropped_width *= r;
    pano_data.cropped_height *= r;
    pano_data.cropped_x *= r;
    pano_data.cropped_y *= r;

    img.width = pano_data.cropped_width;
    img.height = pano_data.cropped_height;

    // Create buffer
    var buffer = document.createElement('canvas');
    buffer.width = pano_data.full_width;
    buffer.height = pano_data.full_height;

    var ctx = buffer.getContext('2d');
    ctx.drawImage(img, pano_data.cropped_x, pano_data.cropped_y, pano_data.cropped_width, pano_data.cropped_height);
    
    self.prop.size.image_width = pano_data.cropped_width;
    self.prop.size.image_height = pano_data.cropped_height;

    self._createScene(buffer);
  };

  var onprogress = function(e) {
    if (e.lengthComputable) {
      var new_progress = parseInt(e.loaded / e.total * 100);
      if (new_progress > progress) {
        progress = new_progress;
        self.loader.setProgress(progress);
      }
    }
  };

  var onerror = function() {
    self.container.textContent = 'Cannot load image';
  };

  loader.load(this.config.panorama, onload, onprogress, onerror);
};

/**
 * Creates the 3D scene and GUI compoents
 * @param img (Canvas) The sphere texture
 * @return (void)
 */
PhotoSphereViewer.prototype._createScene = function(img) {
  this._onResize();
  
  this.raycaster = new THREE.Raycaster();

  // Renderer depends on whether WebGL is supported or not
  this.renderer = PSVUtils.isWebGLSupported() ? new THREE.WebGLRenderer() : new THREE.CanvasRenderer();
  this.renderer.setSize(this.prop.size.width, this.prop.size.height);

  this.camera = new THREE.PerspectiveCamera(this.config.default_fov, this.prop.size.ratio, 1, 300);
  this.camera.position.set(0, 0, 0);

  this.scene = new THREE.Scene();
  this.scene.add(this.camera);

  var texture = new THREE.Texture(img);
  texture.needsUpdate = true;

  // default texture origin is at 1/4 (phiStart=0) of the panorama, I set it at 1/2 (phiStart=PI/2)
  var geometry = new THREE.SphereGeometry(200, 32, 32, -PhotoSphereViewer.HalfPI);
  var material = new THREE.MeshBasicMaterial({map: texture, overdraw: true});
  material.side = THREE.DoubleSide;
  material.map.minFilter = THREE.LinearFilter;
  var mesh = new THREE.Mesh(geometry, material);
  mesh.scale.x = -1;

  this.scene.add(mesh);
  this.canvas_container.appendChild(this.renderer.domElement);

  // Remove loader
  this.container.removeChild(this.loader.container);
  this.loader = null;
  this.container.classList.remove('loading');

  // Navigation bar
  if (this.config.navbar) {
    this.container.classList.add('has-navbar');
    this.navbar = new PSVNavBar(this);
    this.container.appendChild(this.navbar.container);
  }
  
  // HUD
  this.hud = new PSVHUD(this);
  this.config.markers.forEach(function(marker) {
    this.hud.addMarker(marker, true);
  }, this);
  this.container.appendChild(this.hud.container);
  
  // Panel
  this.panel = new PSVPanel(this);
  this.container.appendChild(this.panel.container);
  
  // Tooltip
  this.tooltip = new PSVTooltip(this);
  this.container.appendChild(this.tooltip.container);

  // Queue animation
  if (this.config.time_anim !== false) {
    this.prop.start_timeout = setTimeout(this.startAutorotate.bind(this), this.config.time_anim);
  }

  this._bindEvents();
  this.trigger('ready');
  this.render();
};

/**
 * Add all needed event listeners
 * @return (void)
 */
PhotoSphereViewer.prototype._bindEvents = function() {
  window.addEventListener('resize', this._onResize.bind(this));
  document.addEventListener(PSVUtils.fullscreenEvent(), this._fullscreenToggled.bind(this));
  
  // all interation events are binded to the HUD only
  if (this.config.mousemove) {
    this.hud.container.style.cursor = 'move';
    this.hud.container.addEventListener('mousedown', this._onMouseDown.bind(this));
    this.hud.container.addEventListener('touchstart', this._onTouchStart.bind(this));
    this.hud.container.addEventListener('mouseup', this._onMouseUp.bind(this));
    this.hud.container.addEventListener('touchend', this._onTouchEnd.bind(this));
    this.hud.container.addEventListener('mousemove', this._onMouseMove.bind(this));
    this.hud.container.addEventListener('touchmove', this._onTouchMove.bind(this));
  }
  
  if (this.config.mousewheel) {
    this.hud.container.addEventListener(PSVUtils.mouseWheelEvent(), this._onMouseWheel.bind(this));
  }
};

/**
 * Renders an image
 * @return (void)
 */
PhotoSphereViewer.prototype.render = function() {
  this.prop.direction = new THREE.Vector3(
    -Math.cos(this.prop.latitude) * Math.sin(this.prop.longitude),
    Math.sin(this.prop.latitude),
    Math.cos(this.prop.latitude) * Math.cos(this.prop.longitude)
  );

  this.camera.lookAt(this.prop.direction);
  this.renderer.render(this.scene, this.camera);
  this.trigger('render');
};

/**
 * Internal method for automatic infinite rotation
 * @return (void)
 */
PhotoSphereViewer.prototype._autorotate = function() {
  // Rotates the sphere && Returns to the equator (latitude = 0)
  this.rotate(
    this.prop.longitude + this.prop.anim_speed / this.prop.fps,
    this.prop.latitude - (this.prop.latitude - this.config.anim_lat) / 200
  );

  this.prop.autorotate_timeout = setTimeout(this._autorotate.bind(this), 1000 / this.prop.fps);
};

/**
 * Starts the autorotate animation
 * @return (void)
 */
PhotoSphereViewer.prototype.startAutorotate = function() {
  clearTimeout(this.prop.start_timeout);
  this.prop.start_timeout = null;
  
  this.stopAnimation();
  
  this._autorotate();
  this.trigger('autorotate', true);
};

/**
 * Stops the autorotate animation
 * @return (void)
 */
PhotoSphereViewer.prototype.stopAutorotate = function() {
  clearTimeout(this.prop.start_timeout);
  this.prop.start_timeout = null;

  clearTimeout(this.prop.autorotate_timeout);
  this.prop.autorotate_timeout = null;

  this.trigger('autorotate', false);
};

/**
 * Launches/stops the autorotate animation
 * @return (void)
 */
PhotoSphereViewer.prototype.toggleAutorotate = function() {
  if (this.prop.autorotate_timeout) {
    this.stopAutorotate();
  }
  else {
    this.startAutorotate();
  }
};

/**
 * Resizes the canvas when the window is resized
 * @return (void)
 */
PhotoSphereViewer.prototype._onResize = function() {
  if (this.container.clientWidth != this.prop.size.width || this.container.clientHeight != this.prop.size.height) {
    this.resize(this.container.clientWidth, this.container.clientHeight);
  }
};

/**
 * Resizes the canvas
 * @param width (integer) The new canvas width
 * @param height (integer) The new canvas height
 * @return (void)
 */
PhotoSphereViewer.prototype.resize = function (width, height) {
  this.prop.size.width = parseInt(width);
  this.prop.size.height = parseInt(height);
  this.prop.size.ratio = this.prop.size.width / this.prop.size.height;

  if (this.camera) {
    this.camera.aspect = this.prop.size.ratio;
    this.camera.updateProjectionMatrix();
  }

  if (this.renderer) {
    this.renderer.setSize(this.prop.size.width, this.prop.size.height);
    this.render();
  }

  this.trigger('size-updated', this.prop.size.width, this.prop.size.height);
};

/**
 * The user wants to move
 * @param evt (Event) The event
 * @return (void)
 */
PhotoSphereViewer.prototype._onMouseDown = function(evt) {
  this._startMove(evt);
};

/**
 * The user wants to move (mobile version)
 * @param evt (Event) The event
 * @return (void)
 */
PhotoSphereViewer.prototype._onTouchStart = function(evt) {
  if (evt.touches.length === 1) {
    this._startMove(evt.touches[0]);
  }
  else if (evt.touches.length === 2) {
    this._startZoom(evt);
  }
};

/**
 * Initializes the movement
 * @param evt (Event) The event
 * @return (void)
 */
PhotoSphereViewer.prototype._startMove = function(evt) {
  this.prop.mouse_x = this.prop.start_mouse_x = parseInt(evt.clientX);
  this.prop.mouse_y = this.prop.start_mouse_y = parseInt(evt.clientY);
  this.prop.moving = true;
  this.prop.moved = false;
  this.prop.zooming = false;

  this.stopAutorotate();
  this.stopAnimation();
};

/**
 * Initializes the zoom
 * @param evt (Event) The event
 * @return (void)
 */
PhotoSphereViewer.prototype._startZoom = function(evt) {
  var t = [
    {x: parseInt(evt.touches[0].clientX), y: parseInt(evt.touches[0].clientY)},
    {x: parseInt(evt.touches[1].clientX), y: parseInt(evt.touches[1].clientY)}
  ];
  
  this.prop.pinch_dist = Math.sqrt(Math.pow(t[0].x-t[1].x, 2) + Math.pow(t[0].y-t[1].y, 2));
  this.prop.moving = false;
  this.prop.zooming = true;

  this.stopAutorotate();
  this.stopAnimation();
};

/**
 * The user wants to stop moving
 * @param evt (Event) The event
 * @return (void)
 */
PhotoSphereViewer.prototype._onMouseUp = function(evt) {
  this._stopMove(evt);
};

/**
 * The user wants to stop moving (mobile version)
 * @param evt (Event) The event
 * @return (void)
 */
PhotoSphereViewer.prototype._onTouchEnd = function(evt) {
  this._stopMove(evt.changedTouches[0]);
};

/**
 * Stops the movement
 * @param evt (Event) The event
 * @return (void)
 */
PhotoSphereViewer.prototype._stopMove = function(evt) {
  if (this.prop.moving) {
    if (Math.abs(evt.clientX - this.prop.start_mouse_x) < PhotoSphereViewer.MOVE_THRESHOLD && Math.abs(evt.clientY - this.prop.start_mouse_y) < PhotoSphereViewer.MOVE_THRESHOLD) {
      this._click(evt);
    }
    else {
      this.prop.moved = true;
    }
  }
  
  this.prop.moving = false;
  this.prop.zooming = false;
};

/**
 * Trigger an event with all coordinates when a simple click is performed
 * @param evt (Event) The event
 * @return (void)
 */
PhotoSphereViewer.prototype._click = function(evt) {
  this.trigger('_click', evt);
  if (evt.defaultPrevented) {
    return;
  }
  
  var boundingRect = this.container.getBoundingClientRect();
  
  var data = {
    client_x: parseInt(evt.clientX - boundingRect.left),
    client_y: parseInt(evt.clientY - boundingRect.top)
  };

  var screen = new THREE.Vector2(
    2 * data.client_x / this.prop.size.width - 1,
    - 2 * data.client_y / this.prop.size.height + 1
  );
  
  this.raycaster.setFromCamera(screen, this.camera);
  
  var intersects = this.raycaster.intersectObjects(this.scene.children);
  
  if (intersects.length === 1) {    
    var p = intersects[0].point;
    var phi = Math.acos(p.y / Math.sqrt(p.x*p.x + p.y*p.y + p.z*p.z));
    var theta = Math.atan2(p.x, p.z);
    
    data.longitude = theta < 0 ? - theta : PhotoSphereViewer.TwoPI - theta;
    data.latitude = PhotoSphereViewer.HalfPI - phi;
    
    var relativeLong = data.longitude / PhotoSphereViewer.TwoPI * this.prop.size.image_width;
    var relativeLat = data.latitude / PhotoSphereViewer.PI * this.prop.size.image_height;

    data.texture_x = parseInt(data.longitude < PhotoSphereViewer.PI ? relativeLong + this.prop.size.image_width/2 : relativeLong - this.prop.size.image_width/2);
    data.texture_y = parseInt(this.prop.size.image_height/2 - relativeLat);
  
    this.trigger('click', data);
  }
};

/**
 * The user moves the image
 * @param evt (Event) The event
 * @return (void)
 */
PhotoSphereViewer.prototype._onMouseMove = function(evt) {
  evt.preventDefault();
  this._move(evt);
};

/**
 * The user moves the image (mobile version)
 * @param evt (Event) The event
 * @return (void)
 */
PhotoSphereViewer.prototype._onTouchMove = function(evt) {
  if (evt.touches.length === 1) {
    evt.preventDefault();
    this._move(evt.touches[0]);
  }
  else if (evt.touches.length === 2) {
    evt.preventDefault();
    this._zoom(evt);
  }
};

/**
 * Movement
 * @param evt (Event) The event
 * @return (void)
 */
PhotoSphereViewer.prototype._move = function(evt) {
  if (this.prop.moving) {
    var x = parseInt(evt.clientX);
    var y = parseInt(evt.clientY);
  
    this.rotate(
      this.prop.longitude - (x - this.prop.mouse_x) * this.config.long_offset,
      this.prop.latitude + (y - this.prop.mouse_y) * this.config.lat_offset
    );

    this.prop.mouse_x = x;
    this.prop.mouse_y = y;
  }
};

/**
 * Zoom
 * @param evt (Event) The event
 * @return (void)
 */
PhotoSphereViewer.prototype._zoom = function(evt) {
  if (this.prop.zooming) {
    var t = [
      {x: parseInt(evt.touches[0].clientX), y: parseInt(evt.touches[0].clientY)},
      {x: parseInt(evt.touches[1].clientX), y: parseInt(evt.touches[1].clientY)}
    ];
    
    var p = Math.sqrt(Math.pow(t[0].x-t[1].x, 2) + Math.pow(t[0].y-t[1].y, 2));
    var delta = 80 * (p - this.prop.pinch_dist) / this.prop.size.width;
  
    this.zoom(this.prop.zoom_lvl + delta);

    this.prop.pinch_dist = p;
  }
};

/**
 * Rotate the camera
 * @param t (double) Horizontal angle (rad)
 * @param p (double) Vertical angle (rad)
 * @return (void)
 */
PhotoSphereViewer.prototype.rotate = function(t, p) {
  this.prop.longitude = t - Math.floor(t / PhotoSphereViewer.TwoPI) * PhotoSphereViewer.TwoPI;
  this.prop.latitude = PSVUtils.stayBetween(p, this.config.tilt_down_max, this.config.tilt_up_max);

  if (this.renderer) {
    this.render();
  }

  this.trigger('position-updated', this.prop.longitude, this.prop.latitude);
};

/**
 * Rotate the camera with animation
 * @param t (double) Horizontal angle (rad)
 * @param p (double) Vertical angle (rad)
 * @param s (mixed) Optional. Animation speed or duration (milliseconds)
 * @return (void)
 */
PhotoSphereViewer.prototype.animate = function(t, p, s) {
  if (!s) {
    this.rotate(t, p);
    return;
  }
  
  t = t - Math.floor(t / PhotoSphereViewer.TwoPI) * PhotoSphereViewer.TwoPI;
  p = PSVUtils.stayBetween(p, this.config.tilt_down_max, this.config.tilt_up_max);

  var t0 = this.prop.longitude;
  var p0 = this.prop.latitude;
  
  // get duration of animation
  var duration;
  if (s && typeof s === 'number') {
    duration = s / 1000;
  }
  else {
    // desired radial speed
    var speed = s ? this.parseAnimSpeed(s) : this.prop.anim_speed;
    // get the angle between current position and target
    var angle = Math.acos(Math.cos(p0) * Math.cos(p) * Math.cos(t0-t) + Math.sin(p0) * Math.sin(p));
    duration = angle / speed;
  }
  
  var steps = duration * this.prop.fps;
  
  // longitude offset for shortest arc
  var tCandidates = [
    t - t0, // direct
    PhotoSphereViewer.TwoPI - t0 + t, // clock-wise cross zero
    t - t0 - PhotoSphereViewer.TwoPI // counter-clock-wise cross zero
  ];
  
  var tOffset = tCandidates.reduce(function(value, candidate) {
    return Math.abs(candidate) < Math.abs(value) ? candidate : value;
  }, Infinity);
  
  // latitude offset
  var pOffset = p - p0;
  
  this.stopAutorotate();
  this.stopAnimation();
  
  this._animate(tOffset / steps, pOffset / steps, t, p);
};

/**
 * Internal method for animation
 * @param tStep (double) horizontal angle to move the view each tick
 * @param pStep (double) vertical angle to move the view each tick
 * @param tTarget (double) target horizontal angle
 * @param pTarget (double) target vertical angle
 * @return (void)
 */
PhotoSphereViewer.prototype._animate = function(tStep, pStep, tTarget, pTarget) {
  if (tStep !== 0 && Math.abs(this.prop.longitude - tTarget) <= Math.abs(tStep) * 2) {
    tStep = 0;
    this.prop.longitude = tTarget;
  }
  if (pStep !== 0 && Math.abs(this.prop.latitude - pTarget) <= Math.abs(pStep) * 2) {
    pStep = 0;
    this.prop.latitude = pTarget;
  }
  
  this.rotate(
    this.prop.longitude + tStep,
    this.prop.latitude + pStep
  );
  
  if (tStep !== 0 || pStep !== 0) {
    this.prop.animation_timeout = setTimeout(this._animate.bind(this, tStep, pStep, tTarget, pTarget), 1000 / this.prop.fps);
  }
  else {
    this.stopAnimation();
  }
};

/**
 * Stop the ongoing animation
 * @return (void)
 */
PhotoSphereViewer.prototype.stopAnimation = function() {
  clearTimeout(this.prop.animation_timeout);
  this.prop.animation_timeout = null;
};

/**
 * The user wants to zoom
 * @param evt (Event) The event
 * @return (void)
 */
PhotoSphereViewer.prototype._onMouseWheel = function(evt) {
  evt.preventDefault();
  evt.stopPropagation();

  var delta = evt.deltaY!==undefined ? -evt.deltaY : (evt.wheelDelta!==undefined ? evt.wheelDelta : -evt.detail);

  if (delta !== 0) {
    var direction = parseInt(delta / Math.abs(delta));
    this.zoom(this.prop.zoom_lvl + direction);
  }
};

/**
 * Zoom
 * @paramlevel (integer) New zoom level
 * @return (void)
 */
PhotoSphereViewer.prototype.zoom = function(level) {
  this.prop.zoom_lvl = PSVUtils.stayBetween(parseInt(Math.round(level)), 0, 100);

  this.camera.fov = this.config.max_fov + (this.prop.zoom_lvl / 100) * (this.config.min_fov - this.config.max_fov);
  this.camera.updateProjectionMatrix();
  this.render();

  this.trigger('zoom-updated', this.prop.zoom_lvl);
};

/**
 * Zoom in
 * @return (void)
 */
PhotoSphereViewer.prototype.zoomIn = function() {
  if (this.prop.zoom_lvl < 100) {
    this.zoom(this.prop.zoom_lvl + 1);
  }
};

/**
 * Zoom out
 * @return (void)
 */
PhotoSphereViewer.prototype.zoomOut = function() {
  if (this.prop.zoom_lvl > 0) {
    this.zoom(this.prop.zoom_lvl - 1);
  }
};

/**
 * Fullscreen state has changed
 * @return (void)
 */
PhotoSphereViewer.prototype._fullscreenToggled = function() {
  this.trigger('fullscreen-updated', PSVUtils.isFullscreenEnabled());
};

/**
 * Enables/disables fullscreen
 * @return (void)
 */
PhotoSphereViewer.prototype.toggleFullscreen = function() {
  if (!PSVUtils.isFullscreenEnabled()) {
    PSVUtils.requestFullscreen(this.container);
  }
  else {
    PSVUtils.exitFullscreen();
  }
};

/**
 * Parse the animation speed
 * @param speed (string) The speed, in radians/degrees/revolutions per second/minute
 * @return (double) radians per second
 */
PhotoSphereViewer.prototype.parseAnimSpeed = function(speed) {
  speed = speed.toString().trim();

  // Speed extraction
  var speed_value = parseFloat(speed.replace(/^(-?[0-9]+(?:\.[0-9]*)?).*$/, '$1'));
  var speed_unit = speed.replace(/^-?[0-9]+(?:\.[0-9]*)?(.*)$/, '$1').trim();

  // "per minute" -> "per second"
  if (speed_unit.match(/(pm|per minute)$/)) {
    speed_value /= 60;
  }

  var rad_per_second = 0;

  // Which unit?
  switch (speed_unit) {
    // Degrees per minute / second
    case 'dpm':
    case 'degrees per minute':
    case 'dps':
    case 'degrees per second':
      rad_per_second = speed_value * Math.PI / 180;
      break;

    // Radians per minute / second
    case 'radians per minute':
    case 'radians per second':
      rad_per_second = speed_value;
      break;

    // Revolutions per minute / second
    case 'rpm':
    case 'revolutions per minute':
    case 'rps':
    case 'revolutions per second':
      rad_per_second = speed_value * PhotoSphereViewer.TwoPI;
      break;

    // Unknown unit
    default:
      throw new PSVError('unknown speed unit "' + speed_unit + '"');
  }
  
  return rad_per_second;
};

/**
 * Sets the animation speed
 * @param speed (string) The speed, in radians/degrees/revolutions per second/minute
 * @return (void)
 */
PhotoSphereViewer.prototype.setAnimSpeed = function(speed) {
  this.prop.anim_speed = this.parseAnimSpeed(speed);
};

/**
 * Adds an action
 * @param name (string) Action name
 * @param f (Function) The handler function
 * @return (void)
 */
PhotoSphereViewer.prototype.on = function(name, f) {
  if (!(name in this.actions)) {
    this.actions[name] = [];
  }

  this.actions[name].push(f);
};

/**
 * Triggers an action
 * @param name (string) Action name
 * @param args... (mixed) Arguments to send to the handler functions
 * @return (void)
 */
PhotoSphereViewer.prototype.trigger = function(name, args) {
  args = Array.prototype.slice.call(arguments, 1);
  if ((name in this.actions) && this.actions[name].length > 0) {
    for (var i = 0, l = this.actions[name].length; i < l; ++i) {
      this.actions[name][i].apply(this, args);
    }
  }
};
