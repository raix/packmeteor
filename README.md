Pack Meteor
===========

This is a simple CLI for packaging the Meteor client into a folder. Its useful when creating `Chrome Packaged Apps` but could also be used for `Cordova`.

###Installation:
```
$ npm install packmeteor
```

Rig a Meteor app on `localhost:3000` and install the `appcache` package

Create packaged app folder:
```
$ packmeteor -c hello
```

Autobuild and reload Chrome Packaged App on Meteor hotcode push:
```
$ cd hello
$ packmeteor -ar
```
*NOTE:*
*Close the Chrome before running the script.*
*Current chrome requires manual refresh of the app, goto [chrome://extensions/](chrome://extensions/) and click "update"*

###Usage:
```
$ packmeteor -help

  Usage: packmeteor [options]

  Options:

    -h, --help                        output usage information
    -V, --version                     output the version number
    -c, --create <name>               Create Packaged App
    -a, --autobuild                   Auto build on server update
    -r, --reload                      Reload chrome packaged app (not working due to chrome issue)
    -b, --build [url]                 Client code url [http://localhost:3000]
    -s, --server <url>                Server url, default to build url [http://localhost:3000]
    -t, --target [packaged, cordova]  Target platform [packaged]
    -m, --migration                   Enable Meteor hotcode push
```

###Build from server
The script packages the app from the Meteor app at localhost:3000 (default)
Use `-b http://myclient.com:80` for building the app from this location instead.

###Connection client to server
The packaged client is mounted to the same server as the build server (default). But there may be cases where the client should connect to a different server.
Use `-s http://livedataserver.com:80`

Kind regards Morten, aka @raix
