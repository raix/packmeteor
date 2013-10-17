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
  .option('-r, --reload', 'Reload chrome packaged app (not working due to chrome issue)')

  .option('-b, --build [url]', 'Client code url [http://localhost:3000]', 'http://localhost:3000')
  .option('-s, --server <url>', 'Server url, default to build url [http://localhost:3000]')

  .option('-t, --target [packaged, cordova]', 'Target platform [packaged]', 'packaged')
  .option('-m, --migration', 'Enable Meteor hotcode push')

  .parse(process.argv);

if (program.reload) {
  console.log('Reloading app via Chrome');
}

var urls = {
  build: url.parse(program.build),
  server: url.parse(program.server || program.build)
};

// We have an array/flat object of files in the folder - this is to keep track
// of files to remove - since we are syncronizing with a source
var folderObject = {};
var folderObjectUpdate = function(path) {
  var folder = fs.readdirSync(path || '.');
  if (typeof path === 'undefined') {
    // Reset array
    folderObject = {};
  }

  for (var i = 0; i < folder.length; i++) {
    var filename = folder[i];
    var pathname = ((path)? path + '/' : '') + filename;
    try {
      folderObjectUpdate(pathname);
    } catch(err) {
      folderObject[pathname] = (pathname == 'manifest.json')?true:false;
    }
  }  
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
    var listA = text.split('<script type="text/javascript">');
    var listB = listA[1].split('<!-- CI -->');
    //console.log(listB);
    text = listA[0] + '  <script type="text/javascript" src="index.js"></script>' + listB[1];
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

  // Check that we are in a packaged app directory
  var inPackagedAppFolder = fs.existsSync('manifest.json');

  if (inPackagedAppFolder) {

    var buildPackagedApp = function() {
      currentBuild++;
      // Load manifest.json file
      var manifestString = fs.readFileSync('manifest.json', 'utf8');
      var manifest = {};

      try {
        manifest = JSON.parse(manifestString);  
      } catch(err) {
        throw new Error('manifest.json invalid format, Error: ' + (err.trace || err.message));
      }

      // Load all files from /packmeteor.manifest - serves a list of clientfiles
      // to save into the packaged app - or could we use the appcache manifest?
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
              //queue.add(killChrome);
              queue.add(reloadChromeApps);
            }

            queue.add(function(complete) {
              //console.log('Finished..');
            });
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

      // Remove all files in folder

      // Load all the files from server


    };

    var killChrome = function(complete) {
      var exec = require('child_process').exec;
      var completeFunc = (typeof complete === 'function')?complete:console.log;

      exec('killall Google\ Chrome', function(err) {
        if (err) {
          completeFunc('Could not kill all Chrome');
        } else {
          //console.log('Kill all chrome');
          completeFunc();
        }
      });
    };

    // Start or restart the app
    var reloadChromeApps = function(complete) {
      var exec = require('child_process').exec;
      var completeFunc = (typeof complete === 'function')?complete:console.log;

      var command = chrome + '--args --load-and-launch-app=' + currentPath;

      //console.log('Reload chrome app: ' + command);

      exec(command, function(err) {
        if(err){ //process error
          if (currentBuild === 1) {
            completeFunc('Could not start Chrome packaged app, Error: ' + (err.trace || err.message));
          } else {
            completeFunc('Could not reload Chrome packaged app, Error: ' + (err.trace || err.message));
          }
        } else {
          completeFunc();
        }
      });
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
      var buildbar = new ProgressBar('Auto building packaged Meteor app (x:current)', {
        total: 999999,
        complete: '',
        incomplete: ''
      });

      runForever(urls.build.hostname, urls.build.port, function() {
        // Update the gui
        buildbar.tick(1);
        // Run builder
        buildPackagedApp();
      });
    } else {
      console.log('Start building packaged Meteor app');
      // Run builder
      buildPackagedApp();      
    }
  } else {
    // No packaged app found
    console.log('Must be in a packaged app folder');
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