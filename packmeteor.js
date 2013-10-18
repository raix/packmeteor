#!/usr/bin/env node
/*

  We bundle Meteor client into a Chrome Packaged App folder

*/


// CLI Options
var program = require('commander');
// CLI Colored text
var colors = require('colors');
// CLI Progress bar
var ProgressBar = require('progress');
// CLI DDP connection
var DDPClient = require("ddp");
// Filesystem
var fs = require('fs');
// Url parsing
var url = require('url');
// Path
var path = require('path');
// Chrome browser - only tested on mac
var chrome = 'open -a Google\\ Chrome ';
// HTTP
var http = require('http');
// Queue
var Queue = require('./queue');
// Get current path
var currentPath = path.resolve();
// currentBuild
var currentBuild = 0;
// Build queue syncron
var queue = new Queue();
// List of replacements for correcting index.html
var fileList = [];

program
  .version('0.0.1')
  .option('-c, --create <name>', 'Create Packaged App')
  .option('-a, --autobuild', 'Auto build on server update')
  .option('-r, --reload', 'Reload app')

  .option('-b, --build [url]', 'Client code url [http://localhost:3000]', 'http://localhost:3000')
  .option('-s, --server <url>', 'Server url, default to build url [http://localhost:3000]')

  .option('-t, --target [packaged, cordova]', 'Target platform, default is autodetect')
  .option('-e, --emulate [platform]', 'Reload emulator [android]')
  .option('-d, --device [platform]', 'Reload device [android]')
  .option('-m, --migration', 'Enable Meteor hotcode push')

  .parse(process.argv);


// If user only uses the -e or --emulate the assume android platform
if (program.emulate === true) {
  program.emulate = 'android';
}

if (program.device === true) {
  program.device = 'android';
}

// Check that we are in a packaged app directory
var inPackagedAppFolder = fs.existsSync('manifest.json');
var inCordovaAppFolder = fs.existsSync('config.xml');

if (!program.target) {
  // If target not set then detect packaged or cordova
  if (inPackagedAppFolder) {
    program.target = 'packaged';
  }

  if (inCordovaAppFolder) {
    program.target = 'cordova';
  }
}

// This function returns array of IPv4 interfaces
var getIps = function() {
  // OS for ip
  var os = require('os');
  // Get interfaces
  var netInterfaces = os.networkInterfaces();
  // Result
  var result = [];
  for (var id in netInterfaces) {
    var netFace = netInterfaces[id];
    for (var i = 0; i < netFace.length; i++) {
      var ip = netFace[i];
      if (ip.internal === false && ip.family === 'IPv4') {
        result.push(ip);
      }
    }
  }
  return result;
};

// Init urls
var urls = {
  build: url.parse(program.build),
  server: url.parse(program.server || program.build)
};

// If user havent specified server adr when on cordova - we'll help the user
if (!program.server) {
  // Get list of ip's
  var ips = getIps();
  // If we got any results
  if (ips.length) {
    // Create new adr
    var newAdr = urls.server.protocol + '//' + ips[0].address + ':' + urls.server.port;
    // Parse the server urls
    urls.server = url.parse(newAdr);
  }
}

// We have an array/flat object of files in the folder - this is to keep track
// of files to remove - since we are syncronizing with a source
var folderObject = {};
var folderObjectUpdate = function(path) {
  var dontSync = {
    'manifest.json': true,
    'config.xml': true,
    'index.js': true,
    'index.html': true
  };
  
  if (program.target === 'cordova') {
    // We dont touch the res/* folder could hold icons for the cordova build?
    dontSync['res'] = true;
  }

  var folder = fs.readdirSync(path || '.');
  if (typeof path === 'undefined') {
    // Reset array
    folderObject = {};
  }

  for (var i = 0; i < folder.length; i++) {
    var filename = folder[i];
    var pathname = ((path)? path + '/' : '') + filename;
    try {
      if (!dontSync[pathname]) {
        folderObjectUpdate(pathname);
        folderObject[pathname] = 'path';
      }
    } catch(err) {
      folderObject[pathname] = true;
    }
  }  
};

var cleanFolderInit = function(complete) {
  // Clear container
  folderObject = {};
  // Scan the folder
  folderObjectUpdate();
  // Next
  complete();
};

var cleanFolder = function(complete) {
  // Clean folder after all new files are syncronized,
  for (var file in folderObject) {
    var value = folderObject[file];
    if (value === true || value === 'path') {
      if (value === 'path') {
        try {
          fs.rmdirSync(file);
        } catch(err) {
          // The folder is not empty, thats ok
        }
      } else {
        try {
          fs.unlinkSync(file);
        } catch(err) {
          // This would be an error
          var error = 'Could not remove: ' + file;
          console.log(error.red);
        }
      }
    }
  }
  complete();
};

var updatedFolder = function(path) {
  // Set a "dont remove" flag
  var id = (path.substr(0,1) === '/')?path.substr(1) : path;
  folderObject[id] = false;
};

var saveFileFromServer = function(filename, url) {

  var filepath = path.join(currentPath, filename);
  var dirname = path.dirname(filepath);
  if (url !== '/') {
    fileList.push({
      url: url,
      filename: filename
    });
  }

  // Load resources from server url
  var urlpath = urls.build.href + url.substr(1);

  // Add task to queue
  queue.add(function(complete) {
    var fd;
    
    // Dont clean this filename
    updatedFolder(filename);
    
    // Make sure the path exists
    if (!fs.existsSync(dirname)) {
      fs.mkdirSync(dirname);
    }
    // Start downloading a file
    http.get(urlpath, function(response) {
      if (response.statusCode !== 200) {
        if (response) { 
          complete('Error while downloading: ' + urlpath + ' Code: ' + response.statusCode);
        }
      } else {
        var contentLength = +(response.headers['content-length'] || -1);
        var loadedLength = 0;

        fd = fs.openSync(filepath, 'w');
        response.on("data", function(chunk) {
          loadedLength += chunk.length;   
          fs.write(fd, chunk,  0, chunk.length, null, function(err, written, buffer) {
            if(err) {
              complete('Error while downloading: ' + urlpath + ', Error: ' + err.message);
            } else {
              // TODO: Show file download progress?
              if (contentLength == loadedLength) {
                // Done
              }
            }
          }); 
         });
        
        response.on("end", function() {
          // Check if fd exists?
          setTimeout(function() {
            if (contentLength != loadedLength && contentLength > -1) {
              console.log('File not fully loaded: ' + url + ' ' + filename);
            }
            fs.closeSync(fd);
          }, 300);
          complete();
        });
      }
    }).on('error', function(e) {
      complete('Error while downloading: ' + urlpath);
    });

  });
};

var correctIndexJs = function(code) {
  var result = '';
  // We have to set new loading parametres
  // __meteor_runtime_config__ = {"meteorRelease":"0.6.5.1","ROOT_URL":"http://localhost:3000/","ROOT_URL_PATH_PREFIX":"","serverId":"","DDP_DEFAULT_CONNECTION_URL":"http://localhost:3000"};
  var jsonSettings = code.replace('__meteor_runtime_config__ = ', '').replace('};', '}');
  var settings = {};
  try {
    settings = JSON.parse(jsonSettings);
  } catch(err) {
    settings = {
      'meteorRelease':'unknown',
      'ROOT_URL_PATH_PREFIX': '',
      'serverId': 'migrate'
    };
  }
  // Stop hot code push
  if (!program.migration) {
    settings.serverId = '';
  }

  // Set server connection
  settings.ROOT_URL = urls.server.href;
  settings.DDP_DEFAULT_CONNECTION_URL = urls.server.href;

  runtimeConfig = '__meteor_runtime_config__ = ' + JSON.stringify(settings) + ';';

  // We have to add this workaround - CPA dont support the 'unload' event
  // and we dont bother rewriting sockJS
  var socketJSWorkaround =
    "window.orgAddEventListener = window.addEventListener;\n" +
    "window.addEventListener = function(event, listener, bool) {\n" +
    " if (event !== 'unload') {\n" +
    "  window.orgAddEventListener(event, listener, bool);\n" +
    " }\n" +
    "};\n";

  // Rig the result
  result = runtimeConfig;
  // Add a console log stating that we are up
  result += '\nconsole.log("Packed Meteor is loaded...");\n';
  // Chrome packaged apps are pr. default set as target
  if (program.target === 'packaged') {
    // Add the socketJS workaround
    result += socketJSWorkaround;
  }
  return result;
};

var correctIndexHtml = function(complete) {
  var indexName = 'index.html';
  if (fs.existsSync(indexName)) {
    // Load index.html
    var text = fs.readFileSync(indexName, 'utf8');

    // Chrome packaged apps doesnt allow inline scripts.. We extract it into
    // a seperate file called index.js and add the loader for it
    // We only intercept the first script tag
    text = text.replace('</script>', '<!-- CI -->');
    var listA = text.split('\n<script type="text/javascript">');
    var listB = listA[1].split('<!-- CI -->');
    //console.log(listB);
    text = listA[0];
    // If building for cordova then add the cordova script
    if (program.target === 'cordova') {
      text = text.replace('<head>\n',
        '<head>\n' +
        '  <meta charset="utf-8" />\n' +
        '  <meta name="format-detection" content="telephone=no" />\n' +
        '  <meta name="viewport" content="user-scalable=no, initial-scale=1, maximum-scale=1, minimum-scale=1, width=device-width, height=device-height, target-densitydpi=device-dpi" />\n\n'
      );


      // TODO: Check if we should add more files like plugins
      text += '  <script type="text/javascript" src="cordova.js"></script>\n';
    }
    // Add the rest of html
    text += '  <script type="text/javascript" src="index.js"></script>';
    text += listB[1];
    // Code that should go into index.js
    var code = correctIndexJs(listB[0]);

    // Create the index.js file
    fs.writeFileSync('index.js', code, 'utf8');

    // Loop through fileList
    while (fileList.length) {
      var item = fileList.pop();
      if (item) {
        // Replace url with filename
        text = text.replace(item.url, item.filename.substr(1));
      }
    }
    
    // Reset fileList
    fileList = [];

    // Save file
    fs.writeFileSync(indexName, text, 'utf8');
  } else {
    console.log(indexName + ' not found - cant correct filenames');
  }

  // Done
  complete();
};



/*
  Create app
*/
if (program.create) {
  if (fs.existsSync(program.create)) {
    console.log('Cannot create app, Folder "' + program.create.bold + '" allready exists');
  } else {
    // Create the app dir and rig basic files
    fs.mkdirSync(program.create);
    if (fs.existsSync(program.create)) {
      // Init manifest.json
      var manifest = {
        "manifest_version": 1,
        "name": program.create,
        "version": "0.0.1",
        "permissions": [],
        "app": {
          "background": {
            "scripts": [
              "main.js"
            ]
          }
        },
        "minimum_chrome_version": "23"      
      };
      // Add the server permissions
      manifest.permissions.push(urls.server.href);
      // Write manifest file
      fs.writeFileSync(program.create + '/manifest.json', JSON.stringify(manifest, null, '\t'), 'utf8');
      // Display some helpful guide
      console.log('Created packaged folder "' + program.create.bold + '" and manifest.json file');
      console.log('');
      console.log('$ cd ' + program.create);
      console.log('$ packmeteor -ar' + ' (autobuild and autoreload on)'.grey);
    } else {
      console.log('Could not create folder: ' + program.create);
    }
  } // EO folder not found so create app...

} else {
  console.log('-------------------------------------------');
  console.log('Packaging app from ...: ' + urls.build.href);
  console.log('Connect client app to : ' + urls.server.href);
  console.log('-------------------------------------------');

  if (inPackagedAppFolder || inCordovaAppFolder) {

    if (program.reload) {
      if (program.target === 'packaged') {
        console.log('Reloading app via `Chrome --load-and-launch-app=' + currentPath + '`');        
      }
      if (program.target === 'cordova') {
        console.log('Rebuilding app via `cordova build`');        
      }
    }

    if (program.emulate) {
      console.log('Restart emulator via `cordova emulate ' + program.emulate + '`');
    }

    var buildPackagedApp = function() {
      currentBuild++;
      
      queue.reset();

      queue.add(cleanFolderInit);

      var manifest = {
        "manifest_version": 1
      };
      // Load manifest.json file
      if (inPackagedAppFolder) {
        var manifestString = fs.readFileSync('manifest.json', 'utf8');

        try {
          manifest = JSON.parse(manifestString);  
        } catch(err) {
          throw new Error('manifest.json invalid format, Error: ' + (err.trace || err.message));
        }
      }

      // Load all files from /packmeteor.manifest - serves a list of clientfiles
      // to save into the packaged app - or could we use the appcache manifest?
      // TODO: if we make a Meteor package we should have a better interface
      // than using the appcache?
      var options = {
        hostname: urls.build.hostname,
        port: urls.build.port,
        path: '/app.manifest',
        headers: {'user-agent': 'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.17 (KHTML, like Gecko) Chrome/24.0.1312.60 Safari/537.17'},
        method: 'GET'
      };

      var req = http.request(options, function(res) {
        var body = '';

        // console.log('STATUS: ' + res.statusCode);
        // console.log('HEADERS: ' + JSON.stringify(res.headers));
        // res.headers.content-length
        res.setEncoding('utf8');
        res.on('data', function (chunk) {
          body += chunk;
        });
        res.on('end', function () {
          // Make sure we got the app.manifest
          if (body.length) {

            var lines = body.split('\n');
            // The spec defaults to cache
            var where = 'cache';
            for (var i = 0; i < lines.length; i++) {
              var line = lines[i];
              // Remove comment
              var line = line.split('#')[0];
              // Parse lines
              if (line == '' || line == 'CACHE MANIFEST') {} else
              if (line == 'CACHE:') { where = 'cache'; } else
              if (line == 'FALLBACK:') { where = 'fallback'; } else
              if (line == 'NETWORK:') { where = 'network'; } else
              if (line == 'SETTINGS:') { where = 'settings'; } else
              if (where == 'cache') {
                // This line is cache line
                var filename = line.split('?')[0];
                filename = (filename == '/')?'index.html':filename;
                // Adds task to queue...
                saveFileFromServer(filename, line);
              } else
              if (where == 'fallback') {
                // This line is a fallback line
                //console.log('Fallback: ' + line);
                // TODO: Figure out a way to parse this... Filenames should be url
                // Encoded? - watchout for spaces in filenames...
                //saveFileFromServer(filename, line);
              }
            }

            // Correct the file names in the index.html
            queue.add(correctIndexHtml);

            // Save the manifest file
            queue.add(function(complete) {
              //console.log('write manifest');
              // Increase version nr in configuration
              manifest.manifest_version++;
              //manifest.version++;
              // Save new manifest
              manifestString = JSON.stringify(manifest, null, '\t');
              fs.writeFileSync('manifest.json', manifestString, 'utf8');
              complete();
            });

            // If user wants to reload chrome app
            if (program.reload) {
              if (program.target === 'cordova') {
                // Cordova
                queue.add(prepareCordovaApps);
                queue.add(compileCordovaApps);
              } else {
                // Default target is packaged
                //queue.add(killChrome);
                queue.add(reloadChromeApps);
              }
            }

            if (program.target === 'cordova' && program.emulate) {
              queue.add(emulateCordovaApps);
            }

            if (program.target === 'cordova' && program.device) {
              queue.add(runCordovaApps);
            }

            // Clean the app folder after rebuilding?
            queue.add(cleanFolder);

            // Start the build
            queue.run();
            
          } else {
            console.log(' Add the appcache package'.red);
          }
        });
      });

      req.on('error', function(e) {
        console.log('problem with request: ' + e.message);
      });

      req.end();

    };

    var execute = function(command, name, complete) {
      var exec = require('child_process').exec;
      var completeFunc = (typeof complete === 'function')?complete:console.log;

      // console.log('Execute: ' + name + ' : ' + command);
      exec(command, function(err) {
        if(err){ //process error
          completeFunc('Could not ' + name);
          //completeFunc('Could not ' + name + ', Error: ' + (err.trace || err.message));
        } else {
          completeFunc();
        }
      });
    };    

    var killChrome = function(complete) {
      var command = 'killall Google\ Chrome';
      execute(command, 'kill all Chrome', complete);
    };

    // Start or restart the app
    var reloadChromeApps = function(complete) {
      var command = chrome + '--args --load-and-launch-app=' + currentPath;
      execute(command, 'start Chrome packaged app', complete);
    };

    var prepareCordovaApps = function(complete) {
      var command = 'cordova prepare';
      execute(command, 'prepare cordova app', complete);
    };

    var compileCordovaApps = function(complete) {
      var command = 'cordova compile';
      execute(command, 'compile cordova app', complete);
    };

    var emulateCordovaApps = function(complete) {
      var command = 'cordova emulate ' + program.emulate;
      var name = 'run emulator for ' + program.emulate + ' cordova app';
      execute(command, name, complete);
    };

    var runCordovaApps = function(complete) {
      var command = 'cordova run ' + program.device;
      var name = 'run on ' + program.device + ' cordova app';
      execute(command, name, complete);
    };


    /*

      Rig the forever build option

    */
    // Run a function f at every connect host:port event 
    var runForever = function(host, port, f) {
      // Create connection listener
      var ddpclient = new DDPClient({ host: host, port: port });

      // When we are connected / reconnected then run the handed function
      ddpclient.connect(function(error) {
        // TODO: Test if allready building?
        if (!error) {
          if (typeof f === 'function') {
            try {
              f();
            } catch(err) {
              throw new Error('Could not run function, forever, Error: ' + (err.trace || err.message) );
            }
          } else {
            throw new Error('runForever expects a function');
          }
        }
      });
    };


    // If autobuild added
    if (program.autobuild) {
      // If source is server then listen to the servers ddp
      var buildbar = new ProgressBar('Auto building ' + program.target + ' Meteor app (:current%)', {
        total: 120,
        complete: '',
        incomplete: ''
      });

      queue.progress = function(count, total) {
        var progress = total - count;
        // The queue will update this
        var pct = (total > 0) ? Math.round(progress / total * 100) : 0;
        // Update the gui
        buildbar.curr = pct;
        buildbar.render();
      };

      runForever(urls.build.hostname, urls.build.port, function() {
        // Run builder
        buildPackagedApp();
      });
    } else {
      console.log('Start building ' + program.target + ' Meteor app');
      // Run builder
      buildPackagedApp();      
    }
  } else {
    // No packaged app found
    console.log('Must be in a ' + program.target + ' app folder');
  }
}




// program
//   .version('0.0.1')
//   .option('-p, --peppers', 'Add peppers')
//   .option('-P, --pineapple', 'Add pineapple')
//   .option('-b, --bbq', 'Add bbq sauce')
//   .option('-C, --cheese <type>', 'Add the specified type of cheese [marble]', 'marble')
//   .parse(process.argv);

// console.log('you ordered a pizza with:'.underline.green);
// if (program.peppers) console.log('  - peppers');
// if (program.pineapple) console.log('  - pineapple');
// if (program.bbq) console.log('  - bbq');
// console.log('  - %s cheese', program.cheese);


// var bar = new ProgressBar('downloading [:bar] :percent :etas', {
//   complete: '=',
//   incomplete: ' ',
//   width: 40,
//   total: 100
// });
// var timer = setInterval(function(){
//   bar.tick(1);
//   if (bar.complete) {
//     console.log('\ncomplete\n');
//     clearInterval(timer);
//   }
// }, 100);