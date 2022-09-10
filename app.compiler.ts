import { argv } from 'process';
import { spawn } from 'child_process';
import { watch } from 'chokidar';
import { join, resolve, extname, dirname } from 'path';
import { readdir, stat, writeFile } from 'fs/promises';
import { copy, copyFile, existsSync, mkdir, rm } from 'fs-extra';
import { compileAsync } from 'sass';

const compileOptions = {
    watch: argv.includes('-w') || argv.includes('--compress'),
    compress: argv.includes('-c') || argv.includes('--compress'),
};

const TSExtentions = ['.ts', '.tsx', 'jsx'];
const SASSExtentions = ['.scss', '.sass'];

const outputDirectory = join(resolve(__dirname), 'app/');
const inputSourceDirectory = join(resolve(__dirname), 'src/');
const inputSassDirectory = join(resolve(__dirname), 'scss/');

/**
 * Get all files recursively in a directory
 * @param currentDirectory current directory to look into
 * @param allFiles cumulated files from previous iteration
 * @returns array of files found
 */
export async function getFilesInDirRecursive(currentDirectory: string, allFiles: string[] = []) {
    const files = await readdir(currentDirectory);
    allFiles = allFiles || [];
    for (const file of files) {
        if ((await stat(join(currentDirectory, file))).isDirectory())
            allFiles = await getFilesInDirRecursive(join(currentDirectory, file), allFiles);
        else allFiles?.push(join(currentDirectory, file));
    }
    return allFiles;
}

/**
 * Copy all non TS and SCSS assets to the output directory
 */
export async function CopyAssets() {
    console.log('> Copying Assets...');
    const time = Date.now();

    const files = (await getFilesInDirRecursive(inputSourceDirectory)).filter(
        (file: string) => TSExtentions.concat(SASSExtentions).includes(extname(file)) === false,
    );
    for (const file of files) {
        const destination = file.replace(inputSourceDirectory, outputDirectory);
        await copy(file, destination, { recursive: true });
    }

    console.log(`> Assets copied in ${(Date.now() - time) / 1000}s!`);
}

/**
 * Transpile all SCSS and SASS files whitin the scss directory into a single file inside the ouput directory
 */
export async function TranspileSASS() {
    console.log('> Transpiling SASS...');
    const time = Date.now();
    const css: string[] = [];
    const files = (await getFilesInDirRecursive(inputSassDirectory)).filter((file: string) =>
        SASSExtentions.includes(extname(file)),
    );
    const loadPaths = files.map((file) => dirname(file));
    for (const file of files) {
        const result = await compileAsync(file, {
            style: compileOptions.compress ? 'compressed' : 'expanded',
            loadPaths,
        });
        if (!compileOptions.compress && result.css.length > 0) {
            result.css = `/* File: ${file.replace(inputSassDirectory, '')} */\n${result.css}\n`;
        }
        css.push(result.css);
    }
    await mkdir(join(outputDirectory), { recursive: true });
    await writeFile(join(outputDirectory, 'styles.css'), css.join(''));
    console.log(`> SASS transpiled in ${(Date.now() - time) / 1000}s!`);
}

/**
 * Transpile all typescript files from the source into the output directory
 * @param watchChanges run the transpiler into watch mode
 */
export async function TranspileTypescript(watchChanges = false) {
    let time = Date.now();
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

        tsc.stderr.on('data', (data: Buffer) => console.error(data.toString()));

        tsc.on('close', async (code: number) => {
            if (code != 0) return reject(code);
            console.log(`> Typescript transpiled in ${(Date.now() - time) / 1000}s!`);

            if (compileOptions.compress) {
                time = Date.now();
                console.log('> Compressing Javascript...');
                const jsFiles = await getFilesInDirRecursive(outputDirectory);
                for (const jsFile of jsFiles) {
                    if (extname(jsFile) == '.js') await CompressJavascriptFile(jsFile, jsFile);
                }
                console.log(`> Javascript compressed in ${(Date.now() - time) / 1000}s!`);
            }

            resolve();
        });
    });
}

/**
 * Compress and mangle a javascript file
 * @param filePath the input file path
 * @param outPath the output file path
 */
export async function CompressJavascriptFile(filePath: string, outPath: string) {
    return new Promise<void>((resolve, reject) => {
        const tsc = spawn('uglifyjs', [filePath, '--compress', '--mangle', '-o', outPath], {
            shell: true,
        });

        tsc.stdout.on('data', (data: Buffer) => {
            console.log(data.toString());
        });

        tsc.stderr.on('data', (data: Buffer) => console.error(data.toString()));

        tsc.on('close', (code: number) => {
            if (code != 0) return reject(code);
            resolve();
        });
    });
}

/**
 * Execute each process simultaneously.
 * Print the errors but still throws.
 */
export async function ExecuteEach() {
    await Promise.all([
        TranspileTypescript().catch((error) => {
            console.error(error);
            throw error;
        }),
        TranspileSASS().catch((error) => {
            console.error(error);
            throw error;
        }),
        CopyAssets().catch((error) => {
            console.error(error);
            throw error;
        }),
    ]).catch((code) => {
        process.exit(code > 0 ? code : 1);
    });
}

// Start Watchers
export function StartWatchers() {
    console.log('App Compiler is watching...');

    TranspileTypescript(true);

    watch([inputSourceDirectory, inputSassDirectory], {
        ignoreInitial: true,
    })
        // On Dir Added
        .on('addDir', async (path) => {
            console.log(`- Directory '${path}' was added`);
            const destination = path.replace(inputSourceDirectory, outputDirectory);
            await mkdir(destination, { recursive: true }).catch(console.error);
        })

        // On Dir Removed
        .on('unlinkDir', async (path) => {
            console.log(`- Directory '${path}' was removed`);
            const destination = path.replace(inputSourceDirectory, outputDirectory);
            if (existsSync(destination)) await rm(destination, { recursive: true }).catch(console.error);
        })

        // On File Added
        .on('add', async (path) => {
            const ext = extname(path);
            console.log(`- File '${path}' was added`);
            if (TSExtentions.includes(ext)) return;
            else if (SASSExtentions.includes(ext)) await TranspileSASS().catch(console.error);
            else {
                const destination = path.replace(inputSourceDirectory, outputDirectory);
                await copyFile(path, destination).catch(console.error);
            }
        })

        // On File Removed
        .on('unlink', async (path) => {
            console.log(`- File '${path}' was removed`);
            const ext = extname(path);
            if (TSExtentions.includes(ext)) return;
            else if (SASSExtentions.includes(ext)) await TranspileSASS().catch(console.error);
            else {
                const destination = path.replace(inputSourceDirectory, outputDirectory);
                if (existsSync(destination)) await rm(destination).catch(console.error);
            }
        })

        // On Change
        .on('change', async (path) => {
            console.log(`- Change detected in '${path}'`);
            const ext = extname(path);
            if (TSExtentions.includes(ext)) return;
            else if (SASSExtentions.includes(ext)) await TranspileSASS().catch(console.error);
            else {
                const destination = path.replace(inputSourceDirectory, outputDirectory);
                await copy(path, destination, {
                    overwrite: true,
                    recursive: true,
                }).catch(console.error);
            }
        });
}

// Main Process
(async () => {
    if (compileOptions.watch) StartWatchers();
    else await ExecuteEach();
})();
