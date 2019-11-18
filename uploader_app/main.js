"use strict";

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const commander = require("commander");
const amazon_uploader = require("./src/amazon_uploader");
const app_center_uploader = require("./src/app_center_uploader");
const google_auth = require("./src/google_auth");
const gdrive_uploader = require("./src/gdrive_uploader");
const gplay_uploader = require("./src/gplay_uploader");
const ios_uploader = require("./src/ios_uploader");
const ssh_uploader = require("./src/ssh_uploader");
const slack_uploader = require("./src/slack_uploader");

////////////////////////////////////////////////////////////////////////////////////////////////////

let currentUploadedBytes = 0;
let totalBytes = 0;
let totalMb = 0;

const validateArgumentsLambda = (msg, args)=>{
    for(let i = 0; i < args.length; i++){
        if(args[i] === undefined){
            throw Error(msg);
        }
    }
};

/*const debugPrintArgumentsLambda = (args)=>{
    for(let i = 0; i < args.length; i++){
        console.log(`${i}: ${args[i]}`);
    }
};*/

////////////////////////////////////////////////////////////////////////////////////////////////////

function replaceAllInString(input, old, newVal){
    const result = input.split(old).join(newVal);
    return result;
}

function updateUploadProgress(bytesUploaded) {
    currentUploadedBytes += bytesUploaded;
    const progress = (currentUploadedBytes / totalBytes) * 100;
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    const curMb = Math.round(currentUploadedBytes/1024/1024);
    process.stdout.write(`Upload progress: ${Math.round(progress)}% (${curMb}Mb / ${totalMb}Mb)`);
}

async function calculateTotalUploadsSize(filesPaths){
    const sizePromises = filesPaths.map((filePath)=>{
        return fs.promises.stat(filePath).catch((err)=>{ 
            console.log(err); 
        });
    });
    const allStats = await Promise.all(sizePromises);
    const bytesSize = allStats.reduce((prevVal, stat)=>{
        return prevVal + stat.size;
    }, 0);
    return bytesSize;
}

async function uploadInAmazon(amazonClientId, amazonClientSecret, amazonAppId, amazonInputFile) {
    validateArgumentsLambda("Missing amazon input variables", arguments);

    const progressCb = process.stdout.isTTY ? updateUploadProgress : undefined; // Нужен ли интерактивный режим?

    await amazon_uploader.uploadBuildOnServer(amazonClientId, amazonClientSecret, amazonAppId, amazonInputFile, progressCb);

    return {
        message: `Uploaded on Amazon:\n- ${path.basename(amazonInputFile)}`
    };
}

async function uploadInAppCenter(appCenterAccessToken, appCenterAppName, appCenterAppOwnerName, inputFile, symbolsFile) {
    if (!appCenterAccessToken || !appCenterAppName || !appCenterAppOwnerName || !inputFile){
        throw Error("Missing appcenter input variables");
    }

    const withSymbolsUploading = app_center_uploader.isSymbolsUploadingSupported(inputFile, symbolsFile);

    const progressCb = process.stdout.isTTY ? updateUploadProgress : undefined; // Нужен ли интерактивный режим?

    await app_center_uploader.uploadToHockeyApp(
        appCenterAccessToken, 
        appCenterAppName, 
        appCenterAppOwnerName, 
        inputFile, 
        withSymbolsUploading, 
        symbolsFile, 
        progressCb); // Нужен ли интерактивный режим?
    
    const message = withSymbolsUploading ? 
        `Uploaded on App center:\n- ${path.basename(inputFile)}\n- ${path.basename(symbolsFile)}` : 
        `Uploaded on App center:\n- ${path.basename(inputFile)}`;
    return {
        message: message
    };
}

async function uploadInGDrive(googleEmail, googleKeyId, googleKey, inputFiles, targetFolderId){
    validateArgumentsLambda("Missing google drive enviroment variables", arguments);

    // Создание аутентифицации из параметров
    // https://developers.google.com/identity/protocols/googlescopes#driveactivityv2
    const scopes = [
        "https://www.googleapis.com/auth/drive.file",     // Работа с файлами, созданными текущим приложением
        //"https://www.googleapis.com/auth/drive",        // Работа со всеми файлами на диске
    ];
    const authClient = await google_auth.createAuthClientFromInfo(googleEmail, googleKeyId, googleKey, scopes);

    const progressCb = process.stdout.isTTY ? updateUploadProgress : undefined; // Нужен ли интерактивный режим?

    const uploadResults = await gdrive_uploader.uploadWithAuth(authClient, targetFolderId, inputFiles, progressCb);
    
    // Сообщение в слак
    let slackMessage = "Google drive links:\n";
    for(let i = 0; i < uploadResults.length; i++){
        const uploadInfo = uploadResults[i];
        slackMessage += `- ${uploadInfo.srcFilePath}: ${uploadInfo.webContentLink}\n`;
        //console.log(`Download url for file "${uploadInfo.srcFilePath}": ${uploadInfo.webContentLink}`);
        //console.log(`Web view url for file "${uploadInfo.srcFilePath}": ${uploadInfo.webViewLink}`); 
    }

    // TODO: Result message handle
    return {
        message: slackMessage
    };
}

async function uploadInGPlay(googleEmail, googleKeyId, googleKey, inputFile, targetTrack, packageName){
    validateArgumentsLambda("Missing google play enviroment variables", arguments);

    // Создание аутентифицации из параметров
    const scopes = [
        "https://www.googleapis.com/auth/androidpublisher"
    ];
    const authClient = await google_auth.createAuthClientFromInfo(googleEmail, googleKeyId, googleKey, scopes);

    const progressCb = process.stdout.isTTY ? updateUploadProgress : undefined; // Нужен ли интерактивный режим?

    await gplay_uploader.uploadBuildWithAuth(authClient, packageName, inputFile, targetTrack, progressCb);
    
    // TODO: Result message handle
    return {
        message: `Uploaded on Google Play:\n- ${path.basename(inputFile)}`
    };
}

async function uploadInIOSStore(iosUser, iosPass, ipaToIOSAppStore){
    validateArgumentsLambda("Missing iOS enviroment variables", arguments);

    await ios_uploader.uploadToIOSAppStore(iosUser, iosPass, ipaToIOSAppStore);

    // TODO: Result message handle
    return {
        message: `Uploaded on iOS store:\n- ${path.basename(ipaToIOSAppStore)}`
    };
}

async function uploadFilesBySSH(sshServerName, sshUser, sshPass, sshPrivateKeyFilePath, sshUploadFiles, sshTargetDir){
    validateArgumentsLambda("Missing SSH enviroment variables", arguments);
    
    const progressCb = process.stdout.isTTY ? updateUploadProgress : undefined; // Нужен ли интерактивный режим?
    await ssh_uploader.uploadBySSH(sshServerName, sshUser, sshPass, sshPrivateKeyFilePath, sshUploadFiles, sshTargetDir, progressCb);

    // TODO: Result message handle
    const filesNames = sshUploadFiles.map((filename)=>{
        return path.basename(filename);
    }).join("\n- ");
    return {
        message: `Uploaded on Samba (${sshTargetDir}):\n- ${filesNames}`
    };
}

async function uploadFilesToSlack(slackApiToken, slackChannel, uploadFiles){
    const progressCb = process.stdout.isTTY ? updateUploadProgress : undefined; // Нужен ли интерактивный режим?
    await slack_uploader.uploadFilesToSlack(slackApiToken, slackChannel, uploadFiles, progressCb);

    return {};
}

////////////////////////////////////////////////////////////////////////////////////////////////////

async function main() {
    // Пробуем получить из переменных окружения данные для авторизации
    const amazonClientId = process.env["AMAZON_CLIENT_ID"];
    const amazonClientSecret = process.env["AMAZON_CLIENT_SECRET"];
    const amazonAppId = process.env["AMAZON_APP_ID"];
    const appCenterAccessToken = process.env["APP_CENTER_ACCESS_TOKEN"];
    const appCenterAppName = process.env["APP_CENTER_APP_NAME"];
    const appCenterAppOwnerName = process.env["APP_CENTER_APP_OWNER_NAME"];
    const googleEmail = process.env["GOOGLE_SERVICE_EMAIL"];
    const googleKeyId = process.env["GOOGLE_KEY_ID"];
    const googleKeyRaw = process.env["GOOGLE_KEY"];
    const iosUser = process.env["IOS_USER"]; // TODO: Можно ли передавать так?
    const iosPass = process.env["IOS_PASS"]; // TODO: Можно ли передавать так?
    const sshServerName = process.env["SSH_SERVER"];
    const sshUser = process.env["SSH_USER"];
    const sshPass = process.env["SSH_PASS"];
    const sshPrivateKeyFilePath = process.env["SSH_PRIVATE_KEY_PATH"];
    const slackApiToken = process.env["SLACK_API_TOKEN"];
    const slackChannel = process.env["SLACK_CHANNEL"];

    // Фиксим данные из окружения
    const googleKey = replaceAllInString(googleKeyRaw, "\\n", "\n");

    //////////////////////////////////////////////////////////////////////////////

    // Парсим аргументы коммандной строки, https://github.com/tj/commander.js
    const commaSeparatedList = (value) => {
        return value.split(",").filter((val)=>{
            return val && (val.length > 0);
        });
    };
    commander.option("--amazon_input_file <input apk>", "Input file for amazon uploading");
    commander.option("--app_center_input_file <input .apk or .ipa>", "Input file for app center uploading");
    commander.option("--app_center_symbols_file <input .dSYM.zip>", "Input symbols archive for app center uploading");
    commander.option("--google_drive_files <comma_separeted_file_paths>", "Input files for uploading: -gdrivefiles 'file1','file2'", commaSeparatedList);
    commander.option("--google_drive_target_folder_id <folder_id>", "Target Google drive folder ID");
    commander.option("--google_play_upload_file <file_path>", "File path for google play uploading");
    commander.option("--google_play_target_track <target_track>", "Target track for google play build");
    commander.option("--google_play_package_name <package>", "Package name for google play uploading: com.gameinsight.gplay.island2");
    commander.option("--ipa_to_ios_app_store <ipa build path>", "Ipa file for iOS App store uploading");
    commander.option("--ssh_upload_files <comma_separeted_file_paths>", "Input files for uploading: -sshfiles='file1','file2'", commaSeparatedList);
    commander.option("--ssh_target_server_dir <dir>", "Target server directory for files");
    commander.option("--slack_upload_files <comma_separeted_file_paths>", "Input files for uploading: -slackfiles='file1','file2'", commaSeparatedList);
    commander.parse(process.argv);

    const amazonInputFile = commander.amazon_input_file;
    const appCenterFile = commander.app_center_input_file;
    const appCenterSymbols = commander.app_center_symbols_file;
    const googleDriveFiles = commander.google_drive_files;
    const googleDriveFolderId = commander.google_drive_target_folder_id;
    const googlePlayUploadFile = commander.google_play_upload_file;
    const googlePlayTargetTrack = commander.google_play_target_track;
    const googlePlayPackageName = commander.google_play_package_name;
    const ipaToIOSAppStore = commander.ipa_to_ios_app_store;
    const sshUploadFiles = commander.ssh_upload_files;
    const sshTargetDir = commander.ssh_target_server_dir;
    const slackUploadFiles = commander.slack_upload_files;

    //////////////////////////////////////////////////////////////////////////////

    // Суммарный объем данных для отгрузки для отображения прогресса
    if (process.stdout.isTTY) {         // Нужен ли интерактивный режим?
        // список файликов
        let filesList = [
            amazonInputFile,
            appCenterFile,
            appCenterSymbols,
            googlePlayUploadFile,
            ipaToIOSAppStore,
        ];
        if(googleDriveFiles){
            filesList = filesList.concat(googleDriveFiles);
        }
        if(sshUploadFiles){
            filesList = filesList.concat(sshUploadFiles);
        }
        if(slackUploadFiles){
            filesList = filesList.concat(slackUploadFiles);
        }
        // Отбрасываем пустые
        filesList = filesList.filter(val => {
            return val !== undefined;
        });
        // Считаем размер
        totalBytes = await calculateTotalUploadsSize(filesList);
        totalMb = Math.round(totalBytes/1024/1024);
    }

    // Промисы с будущими результатами
    const allPromises = new Set();

    // Amazon
    if (amazonInputFile) {
        const uploadProm = uploadInAmazon(amazonClientId, amazonClientSecret, amazonAppId, amazonInputFile);
        allPromises.add(uploadProm);
    }

    // App center
    if(appCenterFile){
        const uploadProm = uploadInAppCenter(appCenterAccessToken, appCenterAppName, appCenterAppOwnerName, appCenterFile, appCenterSymbols);
        allPromises.add(uploadProm);
    }

    // Google drive
    if(googleDriveFiles){
        const uploadProm = uploadInGDrive(googleEmail, googleKeyId, googleKey, googleDriveFiles, googleDriveFolderId);
        allPromises.add(uploadProm);
    }

    // Google play
    if(googlePlayUploadFile){
        const uploadProm = uploadInGPlay(googleEmail, googleKeyId, googleKey, googlePlayUploadFile, googlePlayTargetTrack, googlePlayPackageName);
        allPromises.add(uploadProm);
    }

    // iOS
    if(ipaToIOSAppStore){
        const uploadProm = uploadInIOSStore(iosUser, iosPass, ipaToIOSAppStore);
        allPromises.add(uploadProm);
    }

    // SSH
    if(sshUploadFiles){
        const uploadProm = uploadFilesBySSH(sshServerName, sshUser, sshPass, sshPrivateKeyFilePath, sshUploadFiles, sshTargetDir);
        allPromises.add(uploadProm);
    }

    // Slack
    if(slackUploadFiles){
        const uploadProm = uploadFilesToSlack(slackApiToken, slackChannel, slackUploadFiles);
        allPromises.add(uploadProm);
    }

    // Вывод сообщений в слак
    allPromises.forEach((prom)=>{
        // Прописываем удаление из Set при завершении промиса
        // eslint-disable-next-line promise/catch-or-return
        prom.finally(()=>{
            allPromises.delete(prom);
        });
    });
    while(allPromises.size > 0){
        const result = await Promise.race(allPromises);
        if(result.message !== undefined){
            const message = "```" + result.message + "```";
            slack_uploader.sendMessageToSlack(slackApiToken, slackChannel, message);
        }
    }
}

main();