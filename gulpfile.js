var gulp = require('gulp');
var glob = require('glob');
var fs = require('fs');
const { Console } = require('console');

require('@syncfusion/ej2-showcase-helper');

gulp.task('custom-js-scripts', function (done) {
    var ts = require("typescript");
    var tsCompilerOptions = {
        target: ts.ModuleKind.ESNext,
        module: ts.ScriptTarget.ESNext,
        noResolve: true,
        suppressOutputPathCheck: true,
        "jsx": "preserve",
        "noEmitOnError": false,
        "moduleResolution": "node",
        "noLib": false,
        "experimentalDecorators": true,
        "sourceMap": false,
        "pretty": true,
        "skipLibCheck": true
    }

    var tsxFiles = glob.sync('./src/**/*.ts', { ignore: './src/common/all-routes.tsx' });
    var time = (new Date()).getTime();
    var timeConsumingFiles = {};

    for (var tsxFile of tsxFiles) {

        var tsxContent = fs.readFileSync(tsxFile, 'utf8');

        var es6Result = ts.transpileModule(tsxContent, { "compilerOptions": tsCompilerOptions });
        fs.writeFileSync(tsxFile.replace('.ts', '.js'), es6Result.outputText);

        var tempTime = new Date().getTime();
        var completionTime = ((tempTime - time) / 1000);
        console.log(tsxFile.replace('.ts', '.js') + ' in ' + completionTime + 's');
        time = tempTime;
        if (completionTime > 1) {
            timeConsumingFiles[tsxFile] = completionTime + 's';
        }
    }
    console.log(JSON.stringify(timeConsumingFiles, null, 4));
    done();
});

gulp.task('custom-jsx-scripts', function (done) {
    var ts = require("typescript");
    var tsCompilerOptions = {
        target: ts.ModuleKind.ESNext,
        module: ts.ScriptTarget.ESNext,
        noResolve: true,
        suppressOutputPathCheck: true,
        "jsx": "preserve",
        "noEmitOnError": false,
        "moduleResolution": "node",
        "noLib": false,
        "experimentalDecorators": true,
        "sourceMap": false,
        "pretty": true,
        "skipLibCheck": true
    }

    var tsxFiles = glob.sync('./src/**/*.tsx', { ignore: './src/common/all-routes.tsx' });
    var time = (new Date()).getTime();
    var timeConsumingFiles = {};

    for (var tsxFile of tsxFiles) {

        var tsxContent = fs.readFileSync(tsxFile, 'utf8');

        var es6Result = ts.transpileModule(tsxContent, { "compilerOptions": tsCompilerOptions });
        fs.writeFileSync(tsxFile.replace('.tsx', '.jsx'), es6Result.outputText);

        var tempTime = new Date().getTime();
        var completionTime = ((tempTime - time) / 1000);
        console.log(tsxFile.replace('.tsx', '.jsx') + ' in ' + completionTime + 's');
        time = tempTime;
        if (completionTime > 1) {
            timeConsumingFiles[tsxFile] = completionTime + 's';
        }
    }
    console.log(JSON.stringify(timeConsumingFiles, null, 4));
    done();
});

gulp.task('remove-ts-files', function (done) {
    var tsxFiles = glob.sync('./src/**/*.{ts,tsx}', { ignore: '' });
    for (var tsxFile of tsxFiles) {

        fs.unlink(tsxFile, function (err) {
            if (err) throw err;
            //console.log(tsxFile+ ' File deleted!');
          });
    }
    console.log('All ts files removed');
    done();
});
