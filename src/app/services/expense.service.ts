import { Injectable } from '@angular/core';
import { Expense } from '../models/expense';
import { DomSanitizer } from '@angular/platform-browser';
import { Capacitor } from '@capacitor/core';
import { Photo } from '../models/photo';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Filesystem, Directory  } from '@capacitor/filesystem';
import { StorageService } from './storage.service';

@Injectable({
  providedIn: 'root'
})
export class ExpenseService {
  private expenses: Expense[] = [];

  constructor(private sanitizer: DomSanitizer, private storageService: StorageService) {

  }

  async loadSaved() {
    await this.storageService.init();
    this.expenses = await this.storageService.readExpenses();

    if (Capacitor.getPlatform() === 'web') {
      // Display the photo by reading into base64 format
      for (let expense of this.expenses) {
        // Read each saved photo's data from the Filesystem
        if (expense.receipt.filePath) {
          const readFile = await Filesystem.readFile({
              path: expense.receipt.filePath,
              directory: Directory.Data
          });
        
          expense.receipt.webviewPath = `data:image/jpeg;base64,${readFile.data}`;
        }
      }
    }

    return this.expenses;
  }

  getExpense(id: number) {
    return this.expenses.find(expense => expense.id === id);
  }

  // Capture receipt image, stored in temporary storage on the device.
  async captureExpenseReceipt() {
    const imageData = await Camera.getPhoto({
      resultType: CameraResultType.Uri, // file-based data; provides best performance
      source: CameraSource.Camera, // automatically take a new photo with the camera
      quality: 100 // highest quality (0 to 100)
    });
    
    const receiptPath = Capacitor.isNativePlatform() ? imageData.path : imageData.webPath;

    return {
      sanitizedReceiptImage: 
        this.sanitizer.bypassSecurityTrustUrl(Capacitor.convertFileSrc(receiptPath)),
      filepath: receiptPath
    };
  }

  async createUpdateExpense(expense: Expense) {
    const isNewExpense = expense.id === undefined;
    const expenseId = expense.id || this.createExpenseId();

    if (expense.receipt.tempPath) {
      expense.receipt.name = expenseId + '.jpeg';
      const savedReceipt = await this.savePicture(expense.receipt);

      expense.receipt.filePath = savedReceipt.filepath;
      expense.receipt.tempPath = null; // clear placeholder image
      expense.receipt.webviewPath = savedReceipt.webviewPath;
    }
    
    if (isNewExpense) {
      expense.id = expenseId;
      this.expenses.unshift(expense);
      await this.storageService.createExpense(expense, this.expenses);
    }
    else {
      await this.storageService.updateExpense(expense, this.expenses);
    }
        
    return expense;
  }
  
  // Remove expense from local copy and Storage
  async removeExpense(expense: Expense, position: number) {
    this.expenses.splice(position, 1);

    await this.storageService.deleteExpense(expense, this.expenses);

    // Delete Receipt file on disk
    if (expense.receipt.name) {
      await Filesystem.deleteFile({
        path: expense.receipt.name,
        directory: Directory.Data
      });
    }
  }

  // Save picture to file on device
  private async savePicture(cameraPhoto: Photo) {
    // Convert photo to base64 format, required by Filesystem API to save
    const base64Data = await this.readAsBase64(cameraPhoto.tempPath);

    // Write the file to the data directory
    const savedFile = await Filesystem.writeFile({
      path: cameraPhoto.name,
      data: base64Data,
      directory: Directory.Data
    });

    if (Capacitor.isNativePlatform()) {
      // Display the new image by rewriting the 'file://' path to HTTP
      // Details: https://ionicframework.com/docs/building/webview#file-protocol
      return {
        filepath: savedFile.uri,
        webviewPath: Capacitor.convertFileSrc(savedFile.uri),
      };
    }
    else {
      // Use webPath to display the new image instead of base64 since it's 
      // already loaded into memory
      return {
        filepath: cameraPhoto.name,
        webviewPath: cameraPhoto.tempPath
      };
    }
  }

  // Read camera photo into base64 format based on the platform the app is running on
  private async readAsBase64(filepath: string) {
    // ios/android
    if (Capacitor.isNativePlatform()) {
      // Read the file into base64 format
      const file = await Filesystem.readFile({
        path: filepath
      });

      return file.data;
    }
    else {
      // Fetch the photo, read as a blob, then convert to base64 format
      const response = await fetch(filepath);
      const blob = await response.blob();

      return await this.convertBlobToBase64(blob) as string;  
    }
  }

  convertBlobToBase64 = (blob: Blob) => new Promise((resolve, reject) => {
    const reader = new FileReader;
    reader.onerror = reject;
    reader.onload = () => {
        resolve(reader.result);
    };
    reader.readAsDataURL(blob);
  });

  createExpenseId() {
    return new Date().getTime();
  }
}
