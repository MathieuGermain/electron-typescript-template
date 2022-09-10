import { join, resolve, extname, dirname } from 'path';
import { copyFile, mkdir, readdir, stat, writeFile } from 'fs/promises';
import { compileAsync, OutputStyle } from 'sass';
import { spawn } from 'child_process';
import { argv } from 'process';
import { watch } from 'chokidar';

const isWatchEnabled = argv.includes('--watch');
const isCompressed = argv.includes('--compress');

const outputDirectory = join(resolve(__dirname), 'app/');
const inputTSDirectory = join(resolve(__dirname), 'src/');
const inputHtmlDirectory = join(resolve(__dirname), 'src/html/');
const inputSassDirectory = join(resolve(__dirname), 'src/scss/');
const outputStyle: OutputStyle = isCompressed ? 'compressed' : 'expanded';

// Find all files in a directory and it's sub-directories
export async function getFilesInDirRecursive(dir: string, filelist: string[] = []) {
    const files = await readdir(dir);
    filelist = filelist || [];
    for (const file of files) {
        if ((await stat(join(dir, file))).isDirectory()) {
            filelist = await getFilesInDirRecursive(join(dir, file), filelist);
        } else {
            filelist?.push(file);
        }
    }
    return filelist;
}

// Copy HTML
export async function CopyHTML() {
    const time = Date.now();
    console.log('> Copying HTML...');
    const files = (await getFilesInDirRecursive(inputHtmlDirectory)).filter((file: string) => extname(file) == '.html');
    for (const file of files) {
        await mkdir(join(outputDirectory, dirname(file)), { recursive: true });
        await copyFile(join(inputHtmlDirectory, file), join(outputDirectory, file));
    }
    console.log(`> HTML copied in ${(Date.now() - time) / 1000}s!`);
}

// Transpile SASS/SCSS
export async function TranspileSASS() {
    const time = Date.now();
    console.log('> Transpiling SASS...');
    const css: { file: string; css: string }[] = [];
    const files = (await getFilesInDirRecursive(inputSassDirectory)).filter((file: string) =>
        ['.scss', '.sass'].includes(extname(file)),
    );
    const paths = files.map((file) => dirname(file));
    for (const file of files) {
        const result = await compileAsync(join(inputSassDirectory, file), {
            style: outputStyle,
            loadPaths: paths,
        });
        css.push({ file, css: result.css });
    }
    await mkdir(join(outputDirectory), { recursive: true });
    await writeFile(
        join(outputDirectory, 'styles.css'),
        css
            .map((entry) => (entry.css.length > 0 ? '/* File: ' + entry.file + ' */\n' + entry.css + '\n' : undefined))
            .join(''),
    );
    console.log(`> SASS transpiled in ${(Date.now() - time) / 1000}s!`);
}

// Transpile Typescript
export async function TranspileTypescript() {
    const time = Date.now();
    console.log('> Transpiling Typescript...');
    return new Promise<void>((resolve, reject) => {
        const tsc = spawn('tsc', {
            shell: true,
        });

        tsc.stdout.on('data', (data: Buffer) => {
            console.log(data.toString());
        });

        tsc.stderr.on('data', (data: Buffer) => {
            console.error(data.toString());
        });

        tsc.on('close', (code: number) => {
            if (code != 0) {
                return reject(code);
            }
            console.log(`> Typescript transpiled in ${(Date.now() - time) / 1000}s!`);
            resolve();
        });
    });
}

// Execute each
export async function ExecuteEach(dontExitOnError = false) {
    await TranspileTypescript().catch((code) => {
        if (!dontExitOnError) process.exit(code);
    });
    await TranspileSASS().catch((error: Error) => {
        console.error(error.message);
        if (!dontExitOnError) process.exit(1);
    });
    await CopyHTML().catch((error: Error) => {
        console.error(error.message);
        if (!dontExitOnError) process.exit(1);
    });
}

// Start Watchers
export function StartWatchers() {
    // await CompileAll(true);
    console.log('App Compiler is watching...');

    watch(inputHtmlDirectory).on('all', async (event, fileName) => {
        if (event !== 'change') return;
        if (extname(fileName) == '.html') {
            console.log(`- Change detected in ${fileName}...`);
            await CopyHTML().catch(console.error);
        }
    });

    watch(inputSassDirectory).on('all', async (event, fileName) => {
        if (event !== 'change') return;
        if (['.sass', '.scss'].includes(extname(fileName))) {
            console.log(`- Change detected in ${fileName}...`);
            await TranspileSASS().catch(console.error);
        }
    });

    watch(inputTSDirectory).on('all', async (event, fileName) => {
        if (event !== 'change') return;
        if (['.ts'].includes(extname(fileName))) {
            console.log(`- Change detected in ${fileName}...`);
            await TranspileTypescript().catch(console.error);
        }
    });
}

// Main Process
(async () => {
    if (isWatchEnabled) StartWatchers();
    else await ExecuteEach();
})();
