/**
 * Viewer class
 * @param args (Object) Viewer settings
 * - panorama (string) Panorama URL or path (absolute or relative)
 * - container (HTMLElement) Panorama container (should be a div or equivalent)
 * - caption (string) (optional) (null) Text displayed in the navbar
 * - autoload (boolean) (optional) (true) true to automatically load the panorama, false to load it later (with the .load() method)
 * - usexmpdata (boolean) (optional) (true) true if Photo Sphere Viewer must read XMP data, false if it is not necessary
 * - min_fov (number) (optional) (30) The minimal field of view, in degrees, between 1 and 179
 * - max_fov (number) (optional) (90) The maximal field of view, in degrees, between 1 and 179
 * - default_fov (number) (optional) (max_fov) The default field of view, in degrees, between min_fov and max_fov
 * - default_long (number) (optional) (0) The default longitude, in radians, between 0 and 2xPI
 * - default_lat (number) (optional) (0) The default latitude, in radians, between -PI/2 and PI/2
 * - long_offset (number) (optional) (PI/360) The longitude to travel per pixel moved by mouse/touch
 * - lat_offset (number) (optional) (PI/180) The latitude to travel per pixel moved by mouse/touch
 * - time_anim (integer) (optional) (2000) Delay before automatically animating the panorama in milliseconds, false to not animate
 * - anim_speed (string) (optional) (2rpm) Animation speed in radians/degrees/revolutions per second/minute
 * - anim_lat (number) (optional) (default_lat) The latitude, in radians, at which the animation is done
 * - navbar (boolean) (optional) (false) Display the navigation bar if set to true
 * - loading_img (string) (optional) (null) Loading image URL or path (absolute or relative)
 * - size (Object) (optional) (null) Final size of the panorama container (e.g. {width: 500, height: 300})
 */
var PhotoSphereViewer = function(options) {
  if (!(this instanceof PhotoSphereViewer)) {
    return new PhotoSphereViewer(options);
  }

  if (options === undefined || options.panorama === undefined || options.container === undefined) {
    throw 'PhotoSphereViewer: no value given for panorama or container';
  }

  this.config = PSVUtils.deepmerge(PhotoSphereViewer.DEFAULTS, options);

  // normalize config
  this.config.min_fov = PSVUtils.stayBetween(this.config.min_fov, 1, 179);
  this.config.max_fov = PSVUtils.stayBetween(this.config.max_fov, 1, 179);
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

  // references to components
  this.container = this.config.container;
  this.loader = null;
  this.navbar = null;
  this.canvas_container = null;
  this.renderer = null;
  this.scene = null;
  this.camera = null;
  this.actions = {};

  // local properties
  this.prop = {
    fps: 60,
    phi: 0,
    theta: 0,
    theta_offset: 0,
    zoom_lvl: 0,
    mousedown: false,
    mouse_x: 0,
    mouse_y: 0,
    autorotate_timeout: null,
    anim_timeout: null,
    size: {
      width: 0,
      height: 0,
      ratio: 0
    }
  };

  // compute zoom level
  this.prop.zoom_lvl = Math.round((this.config.default_fov - this.config.min_fov) / (this.config.max_fov - this.config.min_fov) * 100);
  this.prop.zoom_lvl-= 2 * (this.prop.zoom_lvl - 50);

  // init
  this.setAnimSpeed(this.config.anim_speed);

  this.rotate(this.config.default_long, this.config.default_lat);

  if (this.config.size !== null) {
    this._setViewerSize(this.config.size);
  }

  if (this.config.autoload) {
    this.load();
  }
};

PhotoSphereViewer.TwoPI = Math.PI * 2.0;
PhotoSphereViewer.HalfPI = Math.PI / 2.0;

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
  long_offset: Math.PI / 720.0,
  lat_offset: Math.PI / 360.0,
  time_anim: 2000,
  anim_speed: '2rpm',
  anim_lat: null,
  navbar: false,
  lang: {
    autorotate: 'Automatic rotation',
    zoom: 'Zoom',
    zoomOut: 'Zoom out',
    zoomIn: 'Zoom in',
    download: 'Download',
    fullscreen: 'Fullscreen'
  },
  mousewheel: true,
  mousemove: true,
  loading_img: null,
  loading_txt: 'Loading...',
  size: null
};

/**
 * Starts to load the panorama
 * @return (void)
 */
PhotoSphereViewer.prototype.load = function() {
  PSVUtils.addClass(this.container, 'psv-container loading');

  // Is canvas supported?
  if (!PSVUtils.isCanvasSupported()) {
    this.container.textContent = 'Canvas is not supported, update your browser!';
    return;
  }

  // Loader
  this.loader = new PSVLoader(this);
  this.container.appendChild(this.loader.getLoader());
  this.loader.create();

  // Canvas container
  this.canvas_container = document.createElement('div');
  this.canvas_container.className = 'psv-canvas-container';
  this.container.appendChild(this.canvas_container);

  // Adding events
  PSVUtils.addEvent(window, 'resize', this._onResize.bind(this));
  if (this.config.mousemove) {
    this.canvas_container.style.cursor = 'move';
    PSVUtils.addEvent(this.canvas_container, 'mousedown', this._onMouseDown.bind(this));
    PSVUtils.addEvent(this.canvas_container, 'touchstart', this._onTouchStart.bind(this));
    PSVUtils.addEvent(document, 'mouseup', this._onMouseUp.bind(this));
    PSVUtils.addEvent(document, 'touchend', this._onMouseUp.bind(this));
    PSVUtils.addEvent(document, 'mousemove', this._onMouseMove.bind(this));
    PSVUtils.addEvent(document, 'touchmove', this._onTouchMove.bind(this));
  }
  if (this.config.mousewheel) {
    PSVUtils.addEvent(this.canvas_container, PSVUtils.mouseWheelEvent(), this._onMouseWheel.bind(this));
  }
  var bindedFullscreenToggled = this._fullscreenToggled.bind(this);
  PSVUtils.addEvent(document, 'fullscreenchange', bindedFullscreenToggled);
  PSVUtils.addEvent(document, 'mozfullscreenchange', bindedFullscreenToggled);
  PSVUtils.addEvent(document, 'webkitfullscreenchange', bindedFullscreenToggled);
  PSVUtils.addEvent(document, 'MSFullscreenChange', bindedFullscreenToggled);

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
    if (xhr.readyState == 4) {
      if (xhr.status == 200 || xhr.status == 0) {
        self.loader.setProgress(100);

        var binary = xhr.responseText;
        var a = binary.indexOf('<x:xmpmeta'), b = binary.indexOf('</x:xmpmeta>');
        var data = binary.substring(a, b);

        // No data retrieved
        if (a == -1 || b == -1 || data.indexOf('GPano:') == -1) {
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
 * Creates the 3D scene
 * @param img (Canvas) The sphere texture
 * @return (void)
 */
PhotoSphereViewer.prototype._createScene = function(img) {
  this._onResize();

  // Renderer depends on whether WebGL is supported or not
  this.renderer = PSVUtils.isWebGLSupported() ? new THREE.WebGLRenderer() : new THREE.CanvasRenderer();
  this.renderer.setSize(this.prop.size.width, this.prop.size.height);

  this.camera = new THREE.PerspectiveCamera(this.config.default_fov, this.prop.size.ratio, 1, 300);
  this.camera.position.set(0, 0, 0);

  this.scene = new THREE.Scene();
  this.scene.add(this.camera);

  var texture = new THREE.Texture(img);
  texture.needsUpdate = true;

  var geometry = new THREE.SphereGeometry(200, 32, 32);
  var material = new THREE.MeshBasicMaterial({map: texture, overdraw: true});
  var mesh = new THREE.Mesh(geometry, material);
  mesh.scale.x = -1;

  this.scene.add(mesh);
  this.canvas_container.appendChild(this.renderer.domElement);

  // Remove loader
  this.container.removeChild(this.loader.getLoader());
  this.loader = null;
  PSVUtils.removeClass(this.container, 'loading');

  // Navigation bar
  if (this.config.navbar) {
    this.navbar = new PSVNavBar(this);
    this.container.appendChild(this.navbar.getBar());
  }

  // Queue animation
  if (this.config.time_anim !== false) {
    this.prop.anim_timeout = setTimeout(this.startAutorotate.bind(this), this.config.time_anim);
  }

  this.trigger('ready');
  this.render();
};

/**
 * Renders an image
 * @return (void)
 */
PhotoSphereViewer.prototype.render = function() {
  var point = new THREE.Vector3();
  point.setX(-Math.cos(this.prop.phi) * Math.sin(this.prop.theta));
  point.setY(Math.sin(this.prop.phi));
  point.setZ(Math.cos(this.prop.phi) * Math.cos(this.prop.theta));

  this.camera.lookAt(point);
  this.renderer.render(this.scene, this.camera);
};

/**
 * Automatically rotates the panorama
 * @return (void)
 */
PhotoSphereViewer.prototype._autorotate = function() {
  // Rotates the sphere && Returns to the equator (phi = 0)
  this.rotate(
    this.prop.theta + this.prop.theta_offset,
    this.prop.phi - (this.prop.phi - this.config.anim_lat) / 200
  );

  this.prop.autorotate_timeout = setTimeout(this._autorotate.bind(this), 1000 / this.prop.fps);
};

/**
 * Starts the autorotate animation
 * @return (void)
 */
PhotoSphereViewer.prototype.startAutorotate = function() {
  this._autorotate();
  this.trigger('autorotate', true);
};

/**
 * Stops the autorotate animation
 * @return (void)
 */
PhotoSphereViewer.prototype.stopAutorotate = function() {
  clearTimeout(this.prop.anim_timeout);
  this.prop.anim_timeout = null;

  clearTimeout(this.prop.autorotate_timeout);
  this.prop.autorotate_timeout = null;

  this.trigger('autorotate', false);
};

/**
 * Launches/stops the autorotate animation
 * @return (void)
 */
PhotoSphereViewer.prototype.toggleAutorotate = function() {
  clearTimeout(this.prop.anim_timeout);

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
  this._startMove(parseInt(evt.clientX), parseInt(evt.clientY));
};

/**
 * The user wants to move (mobile version)
 * @param evt (Event) The event
 * @return (void)
 */
PhotoSphereViewer.prototype._onTouchStart = function(evt) {
  var touch = evt.changedTouches[0];
  if (touch.target.parentNode == this.canvas_container) {
    this._startMove(parseInt(touch.clientX), parseInt(touch.clientY));
  }
};

/**
 * Initializes the movement
 * @param x (integer) Horizontal coordinate
 * @param y (integer) Vertical coordinate
 * @return (void)
 */
PhotoSphereViewer.prototype._startMove = function(x, y) {
  this.prop.mouse_x = x;
  this.prop.mouse_y = y;

  this.stopAutorotate();

  this.prop.mousedown = true;
};

/**
 * The user wants to stop moving
 * @param evt (Event) The event
 * @return (void)
 */
PhotoSphereViewer.prototype._onMouseUp = function(evt) {
  this.prop.mousedown = false;
};

/**
 * The user moves the image
 * @param evt (Event) The event
 * @return (void)
 */
PhotoSphereViewer.prototype._onMouseMove = function(evt) {
  evt.preventDefault();
  this._move(parseInt(evt.clientX), parseInt(evt.clientY));
};

/**
 * The user moves the image (mobile version)
 * @param evt (Event) The event
 * @return (void)
 */
PhotoSphereViewer.prototype._onTouchMove = function(evt) {
  var touch = evt.changedTouches[0];
  if (touch.target.parentNode == this.canvas_container) {
    evt.preventDefault();
    this._move(parseInt(touch.clientX), parseInt(touch.clientY));
  }
};

/**
 * Movement
 * @param x (integer) Horizontal coordinate
 * @param y (integer) Vertical coordinate
 * @return (void)
 */
PhotoSphereViewer.prototype._move = function(x, y) {
  if (this.prop.mousedown) {
    this.rotate(
      this.prop.theta - (x - this.prop.mouse_x) * this.config.long_offset,
      this.prop.phi + (y - this.prop.mouse_y) * this.config.lat_offset
    );

    this.prop.mouse_x = x;
    this.prop.mouse_y = y;
  }
};

/**
 * Rotate the camera
 * @param x (integer) Horizontal angle (rad)
 * @param y (integer) Vertical angle (rad)
 * @return (void)
 */
PhotoSphereViewer.prototype.rotate = function(t, p) {
  this.prop.theta = t - Math.floor(t / PhotoSphereViewer.TwoPI) * PhotoSphereViewer.TwoPI;
  this.prop.phi = PSVUtils.stayBetween(p, -PhotoSphereViewer.HalfPI, PhotoSphereViewer.HalfPI);

  if (this.renderer) {
    this.render();
  }

  this.trigger('position-updated', this.prop.theta, this.prop.phi);
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
 * Sets the animation speed
 * @param speed (string) The speed, in radians/degrees/revolutions per second/minute
 * @return (void)
 */
PhotoSphereViewer.prototype.setAnimSpeed = function(speed) {
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
      throw 'PhotoSphereViewer: unknown speed unit "' + speed_unit + '"';
  }

  // Theta offset
  this.prop.theta_offset = rad_per_second / this.prop.fps;
};

/**
 * Sets the viewer size
 * @param size (Object) An object containing the wanted width and height
 * @return (void)
 */
PhotoSphereViewer.prototype._setViewerSize = function(size) {
  for (var dim in size) {
    if (dim == 'width' || dim == 'height') {
      if (/^[0-9.]+$/.test(size[dim])) {
        size[dim]+= 'px';
      }

      this.container.style[dim] = size[dim];
    }
  }
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
