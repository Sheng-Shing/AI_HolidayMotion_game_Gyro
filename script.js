// 遊戲變數
const gameArea = document.getElementById('game-area');
const paddle = document.getElementById('paddle');
const scoreElement = document.getElementById('score');
const levelElement = document.getElementById('level');
const livesElement = document.getElementById('lives');
const gameOverElement = document.getElementById('game-over');
const finalScoreElement = document.getElementById('final-score');
const restartButton = document.getElementById('restart-button');

// 遊戲狀態
let gameState = {
    score: 0,
    level: 1,
    lives: 3,
    isGameOver: false,
    balls: [],
    paddlePosition: 0,
    paddleWidth: 0,
    sectionWidth: 0,
    gameAreaWidth: 0,
    gameAreaHeight: 0,
    ballSpeed: 2,
    ballFrequency: 1500, // 毫秒
    lastBallTime: 0,
    animationId: null,
    maxBalls: 5,        // 同時最多球數
    difficultyFactor: 1 // 難度係數
};

// BLE 相關變數
let bleDevice = null;
let bleCharacteristic = null;
const BLE_SERVICE_UUID = '0000fff0-0000-1000-8000-00805f9b34fb';
const BLE_CHARACTERISTIC_UUID = '0000fff2-0000-1000-8000-00805f9b34fb';
const bleConnectButton = document.getElementById('ble-connect');
const bleStatusElement = document.getElementById('ble-status');
const BLE_PRESSURE_MAX = 4194303;
const BLE_ROTATION_FULL_SCALE = 800.0;
let leftCalibrate = 0;
let rightCalibrate = 0;

function parsePressureValue(data, startIndex) {
    return data[startIndex] * 256 * 256 + data[startIndex + 1] * 256 + data[startIndex + 2];
}

function parseAccelerationIntensity(data) {
    let ax = (data[5] * 256 + data[6]) / 2048.0;
    let ay = (data[7] * 256 + data[8]) / 2048.0;
    let az = (data[9] * 256 + data[10]) / 2048.0;

    if (ax >= 16.0) ax -= 32.0;
    if (ay >= 16.0) ay -= 32.0;
    if (az >= 16.0) az -= 32.0;

    const aX = ax * 100.0;
    const aY = ay * 100.0;
    const aZ = az * 100.0;
    const intensity = (Math.sqrt(aX * aX + aY * aY + aZ * aZ) - 105.0) * BLE_PRESSURE_MAX / 1000.0;

    return Math.max(0, Math.min(BLE_PRESSURE_MAX, intensity));
}

function parseRotationIntensity(data) {
    let gx = (data[11] * 256 + data[12]) / 16.4;
    let gy = (data[13] * 256 + data[14]) / 16.4;
    let gz = (data[15] * 256 + data[16]) / 16.4;

    if (gx >= 2000.0) gx -= 4000.0;
    if (gy >= 2000.0) gy -= 4000.0;
    if (gz >= 2000.0) gz -= 4000.0;

    const rotationIntensity = Math.max(Math.abs(gx), Math.abs(gy), Math.abs(gz));
    const intensity = rotationIntensity * BLE_PRESSURE_MAX / BLE_ROTATION_FULL_SCALE;

    return Math.max(0, Math.min(BLE_PRESSURE_MAX, intensity));
}

// 檢查平台是否支援藍牙
function checkBluetoothSupport() {
    if (!navigator.bluetooth) {
        const bleControls = document.querySelector('.ble-controls');
        bleControls.innerHTML = '<div class="error-message">您的設備不支援 Web Bluetooth API</div>';
        return false;
    }
    
    // 檢查是否為 iOS 設備
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    if (isIOS) {
        const bleControls = document.querySelector('.ble-controls');
        bleControls.innerHTML = '<div class="error-message">iOS 設備請使用 Safari 瀏覽器</div>';
        return false;
    }
    
    return true;
}

// 連接 BLE 裝置
async function connectBLE() {
    try {
        // 如果已經連接，則斷開連接
        if (bleDevice && bleDevice.gatt.connected) {
            console.log('Disconnecting from BLE device...');
            await bleDevice.gatt.disconnect();
            handleDisconnection();
            return;
        }

        // 只在連接過程中禁用按鈕
        bleConnectButton.disabled = true;
        bleStatusElement.textContent = '正在連接...';
        bleConnectButton.textContent = '請勿握壓軟球';
        
        console.log('Requesting BLE device...');
        bleDevice = await navigator.bluetooth.requestDevice({
            filters: [{
                services: [BLE_SERVICE_UUID]
            }]
        });
        console.log('Device found:', bleDevice.name);

        // 添加斷線監聽器
        bleDevice.addEventListener('gattserverdisconnected', handleDisconnection);

        console.log('Connecting to GATT server...');
        const server = await bleDevice.gatt.connect();
        console.log('Connected to GATT server');

        console.log('Getting primary service...');
        const service = await server.getPrimaryService(BLE_SERVICE_UUID);
        console.log('Got primary service');

        console.log('Getting characteristic...');
        bleCharacteristic = await service.getCharacteristic(BLE_CHARACTERISTIC_UUID);
        console.log('Got characteristic');

        // 檢查特性支持的功能
        console.log('Characteristic properties:', bleCharacteristic.properties);
        
        // 設置通知監聽器
        console.log('Setting up notifications...');
        bleCharacteristic.addEventListener('characteristicvaluechanged', handleBLEValue);
        await bleCharacteristic.startNotifications();
        console.log('Notifications started');

        // 等待一下確保通知已經準備好
        await new Promise(resolve => setTimeout(resolve, 3000));

        // 發送初始化命令
        console.log('Sending initialization command...');
        const encoder = new TextEncoder();
        await bleCharacteristic.writeValue(encoder.encode('BFWLX'));
        console.log('Sent BFWLX command');
    } catch (error) {
        console.error('BLE connection error:', error);
        handleDisconnection();
    }
}

// 處理藍牙斷線
function handleDisconnection() {
    console.log('BLE disconnected');
    bleStatusElement.textContent = '未連接';
    bleStatusElement.classList.remove('connected');
    bleConnectButton.disabled = false;
    bleConnectButton.textContent = '連接快樂動';
    
    // 恢復原始操作說明文字
    const instructionsElement = document.querySelector('.instructions');
    instructionsElement.textContent = '使用鍵盤左右鍵移動檔板';
    
    // 清理藍牙相關變數
    if (bleCharacteristic) {
        bleCharacteristic.removeEventListener('characteristicvaluechanged', handleBLEValue);
    }
    bleDevice = null;
    bleCharacteristic = null;
    leftCalibrate = 0;
    rightCalibrate = 0;
}

// 處理 BLE 接收到的值
function handleBLEValue(event) {
    console.log('Received BLE value');
    const value = event.target.value;
    if (!value) return;

    const data = new Uint8Array(value.buffer);
    if (data.length < 1) return;

    //let left_release = true;
    //let right_release = true;
    console.log('Received data:', data[2], data[3], data[4]);

    if (data[0] < 200) {
        if (data.length < 17) return;

        const packetType = data[0] * 256 + data[1];

        if (packetType === 0x00) {
            leftCalibrate = parsePressureValue(data, 2);
            rightCalibrate = parseRotationIntensity(data);

            if (leftCalibrate > BLE_PRESSURE_MAX) leftCalibrate = 0;
            if (rightCalibrate > BLE_PRESSURE_MAX) rightCalibrate = 0;
            console.log('BLE calibrate left =', leftCalibrate, 'right =', rightCalibrate);
            return;
        }

        let leftVal = parsePressureValue(data, 2);
        let rightVal = parseRotationIntensity(data);

        if (leftVal > BLE_PRESSURE_MAX) leftVal = 0;
        if (rightVal > BLE_PRESSURE_MAX) rightVal = 0;

        if (leftVal > leftCalibrate && leftCalibrate < BLE_PRESSURE_MAX) {
            leftVal = (leftVal - leftCalibrate) / (BLE_PRESSURE_MAX - leftCalibrate);
        } else {
            leftVal = 0;
        }

        if (rightVal > rightCalibrate && rightCalibrate < BLE_PRESSURE_MAX) {
            rightVal = (rightVal - rightCalibrate) / (BLE_PRESSURE_MAX - rightCalibrate);
        } else {
            rightVal = 0;
        }

        // 根據校正後的壓力值與手腕轉動強度移動檔板
        if (leftVal < 0.3 && rightVal > 0.6 ) { //} && right_release) {
           // right_release = false;
            movePaddle('right');
        } else if (leftVal > 0.6 && rightVal < 0.3 ) { //} && left_release) {
            //left_release = false;
            movePaddle('left');
        }
        return;
    }

    // 檢查是否收到 255
    if (data[0] === 255) {
        console.log('Received initialization value: 255');
        const encoder = new TextEncoder();
        bleCharacteristic.writeValue(encoder.encode('ST'));
        console.log('Sent ST command');

        bleStatusElement.textContent = '已連接';
        bleStatusElement.classList.add('connected');
        bleConnectButton.disabled = false;
        bleConnectButton.textContent = '斷開連接';

        // 更新操作說明文字
        const instructionsElement = document.querySelector('.instructions');
        instructionsElement.textContent = '握壓紅色球左移,轉動手腕右移';

        console.log('BLE connected successfully');
    }
    /*if ( normalizedValue_right < 0.3 ) {
        right_release = true;
    }
    if ( normalizedValue_left < 0.3 ) {
        left_release = true;
    }*/
}

// 初始化遊戲
function initGame() {
    // 清除所有現有的球
    const balls = document.querySelectorAll('.ball');
    balls.forEach(ball => {
        gameArea.removeChild(ball);
    });
    
    // 重置遊戲狀態
    gameState.score = 0;
    gameState.level = 1;
    gameState.lives = 10;
    gameState.isGameOver = true;
    gameState.balls = [];
    gameState.ballSpeed = 1.5;
    gameState.ballFrequency = 2000;
    gameState.lastBallTime = 0;
    gameState.maxBalls = 5;
    gameState.difficultyFactor = 1;
    
    // 更新顯示
    scoreElement.textContent = gameState.score;
    levelElement.textContent = gameState.level;
    livesElement.textContent = gameState.lives;
    
    // 顯示遊戲結束畫面
    gameOverElement.classList.remove('hidden');
    finalScoreElement.textContent = '0';
    
    // 設置遊戲區域尺寸
    gameState.gameAreaWidth = gameArea.clientWidth;
    gameState.gameAreaHeight = gameArea.clientHeight;
    
    // 設置檔板 - 每個顏色部分寬度為球直徑的三倍
    const ballDiameter = 20; // 球的直徑
    gameState.sectionWidth = ballDiameter * 3; // 每個顏色部分寬度為球直徑的三倍
    gameState.paddleWidth = gameState.sectionWidth * 3; // 三個顏色部分
    gameState.paddlePosition = (gameState.gameAreaWidth - gameState.paddleWidth) / 2;
    
    // 創建檔板的三個部分
    paddle.innerHTML = '';
    const redSection = document.createElement('div');
    redSection.className = 'paddle-section';
    
    const greenSection = document.createElement('div');
    greenSection.className = 'paddle-section';
    
    const blueSection = document.createElement('div');
    blueSection.className = 'paddle-section';
    
    paddle.appendChild(redSection);
    paddle.appendChild(greenSection);
    paddle.appendChild(blueSection);
    
    // 設置檔板位置和寬度
    paddle.style.left = gameState.paddlePosition + 'px';
    paddle.style.width = gameState.paddleWidth + 'px';
    
    // 停止遊戲循環
    if (gameState.animationId) {
        cancelAnimationFrame(gameState.animationId);
    }
}

// 創建球
function createBall() {
    // 檢查是否已達到最大球數
    if (gameState.balls.length >= gameState.maxBalls) {
        return;
    }
    
    const colors = ['red', 'green', 'blue'];
    const colorIndex = Math.floor(Math.random() * 3);
    const color = colors[colorIndex];
    
    const ball = document.createElement('div');
    ball.className = `ball ${color}-ball`;
    
    // 隨機位置
    const ballX = Math.random() * (gameState.gameAreaWidth - 20);
    ball.style.left = ballX + 'px';
    ball.style.top = '0px';
    
    gameArea.appendChild(ball);
    
    // 在第一關時，所有球使用相同的速度
    const ballSpeed = gameState.level === 1 ? gameState.ballSpeed : 
                     gameState.ballSpeed * (0.8 + Math.random() * 0.4) * gameState.difficultyFactor;
    
    gameState.balls.push({
        element: ball,
        x: ballX,
        y: 0,
        color: color,
        speed: ballSpeed
    });
}

// 移動檔板
function movePaddle(direction) {
    if (gameState.isGameOver) return;
    
    const moveAmount = 20;
    // 允許檔板超出螢幕的最大距離（檔板寬度的2/3）
    const maxOverhang = gameState.paddleWidth * 2/3;
    
    if (direction === 'left') {
        // 允許檔板左側超出螢幕，但最多超出檔板寬度的2/3
        gameState.paddlePosition = Math.max(-maxOverhang, gameState.paddlePosition - moveAmount);
    } else if (direction === 'right') {
        // 允許檔板右側超出螢幕，但最多超出檔板寬度的2/3
        gameState.paddlePosition = Math.min(
            gameState.gameAreaWidth - gameState.paddleWidth + maxOverhang,
            gameState.paddlePosition + moveAmount
        );
    }
    
    paddle.style.left = gameState.paddlePosition + 'px';
}

// 更新球的位置
function updateBalls() {
    const ballsToRemove = [];
    
    gameState.balls.forEach((ball, index) => {
        // 檢查球元素是否仍然存在
        if (!ball.element || !ball.element.parentNode) {
            ballsToRemove.push(index);
            return;
        }

        // 使用球的個別速度而非全局速度
        ball.y += ball.speed;
        ball.element.style.top = ball.y + 'px';
        
        // 檢查是否到達底部
        if (ball.y >= gameState.gameAreaHeight - 20) {
            // 檢查是否與檔板碰撞
            if (ball.x >= gameState.paddlePosition && ball.x <= gameState.paddlePosition + gameState.paddleWidth) {
                // 確定碰到檔板的哪個部分
                const hitPosition = ball.x - gameState.paddlePosition;
                let hitSection;
                
                if (hitPosition < gameState.sectionWidth) {
                    hitSection = 'red';
                } else if (hitPosition < gameState.sectionWidth * 2) {
                    hitSection = 'green';
                } else {
                    hitSection = 'blue';
                }
                
                // 檢查顏色是否匹配
                if (ball.color === hitSection) {
                    // 得分 - 根據難度增加分數
                    const points = Math.floor(10 * gameState.difficultyFactor);
                    gameState.score += points;
                    scoreElement.textContent = gameState.score;
                    
                    // 顯示得分動畫
                    const pointsAnimation = document.createElement('div');
                    pointsAnimation.textContent = '+' + points;
                    pointsAnimation.style.position = 'absolute';
                    pointsAnimation.style.left = ball.x + 'px';
                    pointsAnimation.style.top = (gameState.gameAreaHeight - 40) + 'px';
                    pointsAnimation.style.color = '#ffff00';
                    pointsAnimation.style.fontSize = '18px';
                    pointsAnimation.style.fontWeight = 'bold';
                    pointsAnimation.style.zIndex = '50';
                    gameArea.appendChild(pointsAnimation);
                    
                    // 動畫效果
                    let opacity = 1;
                    let posY = gameState.gameAreaHeight - 40;
                    const fadeInterval = setInterval(() => {
                        opacity -= 0.05;
                        posY -= 2;
                        pointsAnimation.style.opacity = opacity;
                        pointsAnimation.style.top = posY + 'px';
                        
                        if (opacity <= 0) {
                            clearInterval(fadeInterval);
                            gameArea.removeChild(pointsAnimation);
                        }
                    }, 50);
                    
                    // 檢查是否升級
                    if (gameState.score >= gameState.level * 100) {
                        levelUp();
                    }
                } else {
                    // 失去生命
                    gameState.lives--;
                    livesElement.textContent = gameState.lives;
                    
                    // 顯示錯誤動畫
                    paddle.style.backgroundColor = 'rgba(255, 0, 0, 0.3)';
                    setTimeout(() => {
                        paddle.style.backgroundColor = '';
                    }, 300);
                    
                    // 檢查遊戲是否結束
                    if (gameState.lives <= 0) {
                        endGame();
                    }
                }
            } else {
                // 球沒有碰到檔板，失去生命
                gameState.lives--;
                livesElement.textContent = gameState.lives;
                
                // 檢查遊戲是否結束
                if (gameState.lives <= 0) {
                    endGame();
                }
            }
            
            // 移除球
            ballsToRemove.push(index);
        }
    });
    
    // 從後往前移除球，避免索引問題
    for (let i = ballsToRemove.length - 1; i >= 0; i--) {
        const index = ballsToRemove[i];
        if (gameState.balls[index] && gameState.balls[index].element) {
            gameArea.removeChild(gameState.balls[index].element);
        }
        gameState.balls.splice(index, 1);
    }
}

// 升級
function levelUp() {
    gameState.level++;
    levelElement.textContent = gameState.level;
    
    // 增加難度，但增加幅度較小
    gameState.ballSpeed += 0.3; // 降低速度增加幅度
    gameState.ballFrequency = Math.max(500, gameState.ballFrequency - 200); // 降低頻率增加幅度
    gameState.difficultyFactor += 0.1; // 降低難度係數增加幅度
    gameState.maxBalls = Math.min(15, gameState.maxBalls + 1);
    
    // 顯示升級訊息
    const levelUpMessage = document.createElement('div');
    levelUpMessage.textContent = '升級！';
    levelUpMessage.style.position = 'absolute';
    levelUpMessage.style.top = '50%';
    levelUpMessage.style.left = '50%';
    levelUpMessage.style.transform = 'translate(-50%, -50%)';
    levelUpMessage.style.color = 'white';
    levelUpMessage.style.fontSize = '36px';
    levelUpMessage.style.fontWeight = 'bold';
    levelUpMessage.style.textShadow = '0 0 10px #ff0';
    levelUpMessage.style.zIndex = '100';
    gameArea.appendChild(levelUpMessage);
    
    // 2秒後移除訊息
    setTimeout(() => {
        gameArea.removeChild(levelUpMessage);
    }, 2000);
}

// 結束遊戲
function endGame() {
    gameState.isGameOver = true;
    finalScoreElement.textContent = gameState.score;
    gameOverElement.classList.remove('hidden');
    cancelAnimationFrame(gameState.animationId);
    
    // 重置遊戲狀態，但不重置 BLE 狀態
    gameState.score = 0;
    gameState.level = 1;
    gameState.lives = 10;
    gameState.balls = [];
    gameState.ballSpeed = 1.5;
    gameState.ballFrequency = 2000;
    gameState.lastBallTime = 0;
    gameState.maxBalls = 5;
    gameState.difficultyFactor = 1;
    
    // 更新顯示
    scoreElement.textContent = gameState.score;
    levelElement.textContent = gameState.level;
    livesElement.textContent = gameState.lives;
    
    // 清除所有現有的球
    const balls = document.querySelectorAll('.ball');
    balls.forEach(ball => {
        gameArea.removeChild(ball);
    });
    
    // 重置檔板位置
    gameState.paddlePosition = (gameState.gameAreaWidth - gameState.paddleWidth) / 2;
    paddle.style.left = gameState.paddlePosition + 'px';
}

// 遊戲循環
function gameLoop(timestamp) {
    if (!gameState.lastBallTime) {
        gameState.lastBallTime = timestamp;
    }
    
    // 根據頻率創建新球
    if (timestamp - gameState.lastBallTime > gameState.ballFrequency) {
        createBall();
        gameState.lastBallTime = timestamp;
    }
    
    // 更新球的位置
    updateBalls();
    
    // 繼續遊戲循環
    if (!gameState.isGameOver) {
        gameState.animationId = requestAnimationFrame(gameLoop);
    }
}

// 鍵盤控制
document.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') {
        movePaddle('left');
    } else if (event.key === 'ArrowRight') {
        movePaddle('right');
    }
});

// 重新開始按鈕
restartButton.addEventListener('click', () => {
    gameState.isGameOver = false; // 設置遊戲開始
    gameOverElement.classList.add('hidden');
    gameLoop(); // 開始遊戲循環
});

// 添加藍牙按鈕事件監聽器
bleConnectButton.addEventListener('click', connectBLE);

// 在頁面加載時檢查藍牙支援
window.addEventListener('load', () => {
    if (!checkBluetoothSupport()) {
        return;
    }
    initGame();
});
