import { argv } from 'process';
import { spawn } from 'child_process';
import { watch } from 'chokidar';
import { join, resolve, extname, dirname } from 'path';
import { readdir, stat, writeFile } from 'fs/promises';
import { copy, copyFile, mkdir, rmdir, unlink } from 'fs-extra';
import { compileAsync, OutputStyle } from 'sass';

const isWatchEnabled = argv.includes('--watch');
const isCompressed = argv.includes('--compress');

const outputDirectory = join(resolve(__dirname), 'app/');
const inputSourceDirectory = join(resolve(__dirname), 'src/');
const inputSassDirectory = join(resolve(__dirname), 'scss/');
const outputStyle: OutputStyle = isCompressed ? 'compressed' : 'expanded';

// Find all files in a directory and it's sub-directories
export async function getFilesInDirRecursive(dir: string, filelist: string[] = []) {
    const files = await readdir(dir);
    filelist = filelist || [];
    for (const file of files) {
        if ((await stat(join(dir, file))).isDirectory()) {
            filelist = await getFilesInDirRecursive(join(dir, file), filelist);
        } else {
            filelist?.push(join(dir, file));
        }
    }
    return filelist;
}

// Copy Assets
export async function CopyAssets() {
    console.log('> Copying Assets...');
    const time = Date.now();
    const files = (await getFilesInDirRecursive(inputSourceDirectory)).filter(
        (file: string) => ['.ts', '.scss', '.sass'].includes(extname(file)) === false,
    );
    for (const file of files) {
        const destination = file.replace(inputSourceDirectory, outputDirectory);
        await copy(file, destination, { recursive: true });
    }
    console.log(`> Assets copied in ${(Date.now() - time) / 1000}s!`);
}

// Transpile SASS/SCSS
export async function TranspileSASS() {
    console.log('> Transpiling SASS...');
    const time = Date.now();
    const css: { file: string; css: string }[] = [];
    const files = (await getFilesInDirRecursive(inputSassDirectory)).filter((file: string) =>
        ['.scss', '.sass'].includes(extname(file)),
    );
    const loadPaths = files.map((file) => dirname(file));
    for (const file of files) {
        const result = await compileAsync(file, {
            style: outputStyle,
            loadPaths,
        });
        css.push({ file: file.replace(inputSassDirectory, ''), css: result.css });
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
export async function TranspileTypescript(watchChanges = false) {
    const time = Date.now();
    console.log('> Transpiling Typescript...');

    return new Promise<void>((resolve, reject) => {
        const tsc = spawn('tsc', [watchChanges ? `--watch` : ''], {
            shell: true,
        });

        tsc.stdout.on('data', (data: Buffer) => {
            // Hack to stop tsc --watch from clearing the console
            const str = data.toString().split('\x1B').join('').trim();
            if (str.includes('error')) process.stdout.write(str + '\n');
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
export async function ExecuteEach(exitOnError = true) {
    await Promise.all([
        TranspileTypescript().catch((code) => {
            if (exitOnError) process.exit(code);
        }),

        TranspileSASS().catch((error: Error) => {
            console.error(error.message);
            if (exitOnError) process.exit(1);
        }),

        CopyAssets().catch((error: Error) => {
            console.error(error.message);
            if (exitOnError) process.exit(1);
        }),
    ]);
}

// Start Watchers
export function StartWatchers() {
    console.log('App Compiler is watching...');

    watch(inputSourceDirectory).on('add', async (path) => {
        const ext = extname(path);

        console.log(`- File ${path} was added...`);

        // TS file changed
        if (['.ts'].includes(ext)) await TranspileTypescript().catch(console.error);
        // SASS file changed
        else if (['.sass', '.scss'].includes(extname(path))) await TranspileSASS().catch(console.error);
        // Any other file
        else {
            const destination = path.replace(inputSourceDirectory, outputDirectory);
            await copyFile(path, destination);
        }
    });

    watch(inputSourceDirectory).on('addDir', async (path) => {
        console.log(`- Directory ${path} was added...`);

        const destination = path.replace(inputSourceDirectory, outputDirectory);
        await mkdir(destination, { recursive: true });
    });

    watch(inputSourceDirectory).on('unlink', async (path) => {
        console.log(`- File ${path} was removed...`);

        const ext = extname(path);

        // TS file changed
        if (['.ts'].includes(ext)) await TranspileTypescript().catch(console.error);
        // SASS file changed
        else if (['.sass', '.scss'].includes(extname(path))) await TranspileSASS().catch(console.error);
        // Any other file
        else {
            const destination = path.replace(inputSourceDirectory, outputDirectory);
            await unlink(destination);
        }
    });

    watch(inputSourceDirectory).on('unlinkDir', async (path) => {
        console.log(`- Directory ${path} was removed...`);

        const destination = path.replace(inputSourceDirectory, outputDirectory);
        await rmdir(destination);
    });

    watch(inputSourceDirectory).on('change', async (path) => {
        console.log(`- Change detected in ${path}...`);
        const ext = extname(path);

        // TS file changed
        if (['.ts'].includes(ext)) await TranspileTypescript().catch(console.error);
        // SASS file changed
        else if (['.sass', '.scss'].includes(extname(path))) await TranspileSASS().catch(console.error);
        // Any other file
        else {
            const destination = path.replace(inputSourceDirectory, outputDirectory);
            await copy(path, destination, {
                overwrite: true,
                recursive: true,
            });
        }
    });
}

// Main Process
(async () => {
    if (isWatchEnabled) StartWatchers();
    else await ExecuteEach();
})();
